from dataclasses import dataclass
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import textwrap
from urllib.parse import unquote, urlparse
from uuid import uuid4

import httpx


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class InstallContext:
    app_name: str
    is_frozen: bool
    current_executable: Path | None
    install_dir: Path
    installed_executable: Path
    start_menu_shortcut: Path
    is_running_installed_copy: bool

    @property
    def can_self_manage(self) -> bool:
        return self.is_frozen and self.current_executable is not None

    @property
    def needs_installation(self) -> bool:
        return self.can_self_manage and not self.is_running_installed_copy


def get_install_context(app_name: str) -> InstallContext:
    local_appdata = Path(os.getenv("LOCALAPPDATA") or Path.home())
    appdata = Path(os.getenv("APPDATA") or Path.home())
    install_dir = local_appdata / "Programs" / app_name
    start_menu_shortcut = appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs" / f"{app_name}.lnk"
    current_executable = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else None
    default_installed_executable = install_dir / f"{app_name}.exe"
    running_from_install_dir = _same_path(current_executable.parent, install_dir) if current_executable else False
    installed_executable = (
        current_executable
        if current_executable and running_from_install_dir and (current_executable.parent / "_internal").exists()
        else default_installed_executable
    )

    return InstallContext(
        app_name=app_name,
        is_frozen=bool(getattr(sys, "frozen", False)),
        current_executable=current_executable,
        install_dir=install_dir,
        installed_executable=installed_executable,
        start_menu_shortcut=start_menu_shortcut,
        is_running_installed_copy=(
            _same_path(current_executable, installed_executable)
            or (current_executable is not None and running_from_install_dir and (current_executable.parent / "_internal").exists())
        ),
    )


def install_self(app_name: str) -> InstallContext:
    context = get_install_context(app_name)
    if not context.can_self_manage or not context.current_executable:
        raise RuntimeError("Self-install is only available in the packaged desktop app.")

    source_dir = context.current_executable.parent
    context.install_dir.mkdir(parents=True, exist_ok=True)

    # Folder-based builds need the launcher EXE and the bundled runtime files.
    # Copying only the EXE leaves out `_internal`, which breaks startup.
    if (source_dir / "_internal").exists():
        for child in source_dir.iterdir():
            destination = context.install_dir / child.name
            if child.is_dir():
                if destination.exists():
                    shutil.rmtree(destination)
                shutil.copytree(child, destination)
            else:
                shutil.copy2(child, destination)
    else:
        shutil.copy2(context.current_executable, context.installed_executable)

    _create_start_menu_shortcut(context.installed_executable, context.start_menu_shortcut)
    return get_install_context(app_name)


def queue_launch_installed_copy(installed_executable: Path) -> None:
    script = textwrap.dedent(
        """
        param(
          [string]$TargetPath,
          [int]$WaitPid
        )

        for ($i = 0; $i -lt 240; $i++) {
          if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) {
            break
          }
          Start-Sleep -Milliseconds 500
        }

        Start-Process -FilePath $TargetPath -WorkingDirectory (Split-Path -Parent $TargetPath)
        """
    ).strip()
    _spawn_post_exit_script(script, [str(installed_executable), str(os.getpid())])


def download_update_package(download_url: str, temp_dir: Path, app_name: str) -> Path:
    if not download_url.strip():
        raise RuntimeError("No update link is configured for this desktop app.")

    temp_dir.mkdir(parents=True, exist_ok=True)
    destination: Path | None = None

    try:
        with httpx.Client(follow_redirects=True, timeout=60.0) as client:
            with client.stream("GET", download_url) as response:
                response.raise_for_status()
                source_name = _infer_download_name(response, download_url, app_name)
                destination = _build_temp_download_path(temp_dir, source_name, app_name)
                with destination.open("wb") as handle:
                    for chunk in response.iter_bytes():
                        if chunk:
                            handle.write(chunk)
    except httpx.HTTPError as error:
        raise RuntimeError("Could not download the latest desktop build. Check the connection and try again.") from error

    if not destination.exists() or destination.stat().st_size <= 0:
        destination.unlink(missing_ok=True)
        raise RuntimeError("The downloaded update file was empty.")

    return destination


def is_likely_installer_package(downloaded_file: Path, download_url: str = "") -> bool:
    candidates = [downloaded_file.name.casefold(), download_url.casefold()]
    if any(token in candidate for candidate in candidates for token in ("setup", "installer")):
        return True

    try:
        with downloaded_file.open("rb") as handle:
            sample = handle.read(1024 * 1024)
    except OSError:
        return False

    markers = (
        b"Inno Setup",
        b"NullsoftInst",
        b"NSIS Error",
        b"WiX Toolset",
    )
    return any(marker in sample for marker in markers)


def queue_replace_and_restart(downloaded_executable: Path, target_executable: Path) -> None:
    target_executable.parent.mkdir(parents=True, exist_ok=True)
    script = textwrap.dedent(
        """
        param(
          [string]$SourcePath,
          [string]$TargetPath,
          [int]$WaitPid
        )

        for ($i = 0; $i -lt 240; $i++) {
          if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) {
            break
          }
          Start-Sleep -Milliseconds 500
        }

        $copied = $false
        for ($i = 0; $i -lt 60; $i++) {
          try {
            Copy-Item -LiteralPath $SourcePath -Destination $TargetPath -Force
            $copied = $true
            break
          } catch {
            Start-Sleep -Seconds 1
          }
        }

        if ($copied) {
          Start-Process -FilePath $TargetPath -WorkingDirectory (Split-Path -Parent $TargetPath)
          Remove-Item -LiteralPath $SourcePath -Force -ErrorAction SilentlyContinue
        }
        """
    ).strip()
    _spawn_post_exit_script(script, [str(downloaded_executable), str(target_executable), str(os.getpid())])


def queue_run_installer_and_restart(installer_path: Path) -> None:
    script = textwrap.dedent(
        """
        param(
          [string]$InstallerPath,
          [int]$WaitPid
        )

        for ($i = 0; $i -lt 240; $i++) {
          if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) {
            break
          }
          Start-Sleep -Milliseconds 500
        }

        Start-Process -FilePath $InstallerPath -WorkingDirectory (Split-Path -Parent $InstallerPath)
        """
    ).strip()
    _spawn_post_exit_script(script, [str(installer_path), str(os.getpid())])


def _create_start_menu_shortcut(target_executable: Path, shortcut_path: Path) -> None:
    shortcut_path.parent.mkdir(parents=True, exist_ok=True)
    command = (
        "$ws = New-Object -ComObject WScript.Shell; "
        "$sc = $ws.CreateShortcut($args[1]); "
        "$sc.TargetPath = $args[0]; "
        "$sc.WorkingDirectory = Split-Path -Parent $args[0]; "
        "$sc.IconLocation = \"$($args[0]),0\"; "
        "$sc.Save()"
    )
    subprocess.run(
        [
            _powershell_executable(),
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
            str(target_executable),
            str(shortcut_path),
        ],
        check=False,
        creationflags=CREATE_NO_WINDOW,
    )


def _spawn_post_exit_script(script_body: str, args: list[str]) -> None:
    script_path = Path(os.getenv("TEMP") or Path.cwd()) / f"thrivetracker-post-exit-{uuid4().hex}.ps1"
    script_path.write_text(script_body, encoding="utf-8")
    subprocess.Popen(
        [
            _powershell_executable(),
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            str(script_path),
            *args,
        ],
        creationflags=CREATE_NO_WINDOW,
        close_fds=False,
    )


def _powershell_executable() -> str:
    windir = os.getenv("WINDIR", r"C:\Windows")
    return str(Path(windir) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")


def _build_temp_download_path(temp_dir: Path, source_name: str, app_name: str) -> Path:
    parsed = Path(source_name)
    stem = _sanitize_filename(parsed.stem) or f"{app_name}-update"
    suffix = parsed.suffix if parsed.suffix else ".exe"
    return temp_dir / f"{stem}-{uuid4().hex}{suffix}"


def _infer_download_name(response: httpx.Response, download_url: str, app_name: str) -> str:
    content_disposition = response.headers.get("content-disposition", "")
    for pattern in (r'filename\*=UTF-8\'\'([^;]+)', r'filename="?([^";]+)"?'):
        match = re.search(pattern, content_disposition, flags=re.IGNORECASE)
        if match:
            candidate = Path(unquote(match.group(1))).name
            if candidate:
                return candidate

    for candidate_url in (str(response.url), download_url):
        path_name = Path(unquote(urlparse(candidate_url).path)).name
        if path_name:
            return path_name

    return f"{app_name}-update.exe"


def _sanitize_filename(value: str) -> str:
    return re.sub(r'[^A-Za-z0-9._-]+', '-', value).strip(".- ")


def _same_path(left: Path | None, right: Path | None) -> bool:
    if left is None or right is None:
        return False

    return str(left.resolve()).casefold() == str(right.resolve()).casefold()
