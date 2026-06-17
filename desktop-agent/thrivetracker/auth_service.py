from dataclasses import dataclass

from supabase import create_client


class AuthError(RuntimeError):
    pass


@dataclass
class AuthenticatedUser:
    user_id: str
    email: str
    full_name: str
    role: str
    access_token: str
    refresh_token: str
    remember_session: bool = False

    def update_session(self, access_token: str, refresh_token: str | None = None) -> None:
        self.access_token = access_token
        if refresh_token:
            self.refresh_token = refresh_token


class SupabaseAuthService:
    def sign_in(self, supabase_url: str, anon_key: str, email: str, password: str) -> AuthenticatedUser:
        if not supabase_url:
            raise AuthError("Supabase URL is required.")
        if not anon_key:
            raise AuthError("Supabase anon key is required.")
        if not email:
            raise AuthError("Email is required.")
        if not password:
            raise AuthError("Password is required.")

        client = create_client(supabase_url, anon_key)
        auth_response = client.auth.sign_in_with_password(
            {
                "email": email,
                "password": password,
            }
        )

        if not auth_response.user or not auth_response.session:
            raise AuthError("Login failed. Check the email and password.")

        return self._user_from_session(client, str(auth_response.user.id), auth_response.session)

    def restore_session(
        self,
        supabase_url: str,
        anon_key: str,
        access_token: str,
        refresh_token: str,
    ) -> AuthenticatedUser:
        if not refresh_token:
            raise AuthError("No saved login session was found.")

        try:
            client = create_client(supabase_url, anon_key)
            auth_response = client.auth.refresh_session(refresh_token)
        except Exception as error:
            raise AuthError("Saved login expired. Please sign in again.") from error

        if not auth_response.user or not auth_response.session:
            raise AuthError("Saved login expired. Please sign in again.")

        return self._user_from_session(client, str(auth_response.user.id), auth_response.session)

    def refresh_session(self, supabase_url: str, anon_key: str, user: AuthenticatedUser) -> AuthenticatedUser:
        if not user.refresh_token:
            raise AuthError("Login session cannot be refreshed. Please sign in again.")

        try:
            client = create_client(supabase_url, anon_key)
            auth_response = client.auth.refresh_session(user.refresh_token)
        except Exception as error:
            raise AuthError("Could not refresh Supabase login session.") from error

        if not auth_response.session or not auth_response.session.access_token:
            raise AuthError("Supabase did not return a refreshed login session.")

        user.update_session(
            access_token=auth_response.session.access_token,
            refresh_token=auth_response.session.refresh_token,
        )
        return user

    def _user_from_session(self, client, user_id: str, session) -> AuthenticatedUser:
        profile_response = (
            client.table("profiles")
            .select("id,email,full_name,role,is_active")
            .eq("id", user_id)
            .single()
            .execute()
        )
        profile = profile_response.data
        if not profile:
            raise AuthError("Profile was not found for this user.")
        if not profile.get("is_active"):
            raise AuthError("This user is inactive.")
        if profile.get("role") != "va":
            raise AuthError("Desktop agent access is for VA accounts only.")

        return AuthenticatedUser(
            user_id=user_id,
            email=profile.get("email") or "",
            full_name=profile.get("full_name") or profile.get("email") or "VA",
            role=profile.get("role") or "va",
            access_token=session.access_token,
            refresh_token=session.refresh_token,
        )
