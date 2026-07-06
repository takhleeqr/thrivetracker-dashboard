#ifndef MyAppName
  #define MyAppName GetStringFileInfo(AddBackslash(SourcePath) + "dist\\ThriveTracker.exe", "ProductName")
#endif

#ifndef MyAppName
  #define MyAppName "Tracker"
#endif

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#ifndef MyAppPublisher
  #define MyAppPublisher MyAppName
#endif

#ifndef MyAppExeName
  #define MyAppExeName "ThriveTracker.exe"
#endif

#ifndef MyAppSourceExe
  #define MyAppSourceExe AddBackslash(SourcePath) + "dist\\ThriveTracker.exe"
#endif

#ifndef MyAppIconFile
  #define MyAppIconFile AddBackslash(SourcePath) + "assets\\icon.ico"
#endif

#ifndef MyAppOutputDir
  #define MyAppOutputDir AddBackslash(SourcePath) + "release"
#endif

#ifndef MyAppOutputBaseFilename
  #define MyAppOutputBaseFilename MyAppName + "-Setup"
#endif

#ifndef MyAppId
  #define MyAppId MyAppName + "-desktop"
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#MyAppOutputDir}
OutputBaseFilename={#MyAppOutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#MyAppIconFile}
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#MyAppSourceExe}"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
