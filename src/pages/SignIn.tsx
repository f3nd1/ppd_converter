import type { Me } from '../App.tsx'

// The front door. Without this the app 401s on every page and offers no way in
// — which is exactly what happened on first deployment: the backend OAuth flow
// existed and worked, but nothing ever linked to it.

const START = '/ppd_converter/api/auth/google/start'

export default function SignIn({ me, error }: { me: Me | null; error?: string }) {
  // Signed in, but with the wrong Google account. Say so plainly rather than
  // letting it look like a general failure — the restriction is deliberate.
  const wrongAccount = Boolean(me?.email && !me.authorised)

  return (
    <div className="signin">
      <div className="signin-card">
        <h1>PPD Converter</h1>
        <p className="brand-sub">United Ceres College</p>

        {wrongAccount ? (
          <p className="blocked" role="status">
            You are signed in as <strong>{me?.email}</strong>, which is not authorised.
            Only <strong>{me?.allowedAccount}</strong> may use this application.
          </p>
        ) : (
          <p className="empty">Sign in with your United Ceres College Google account to continue.</p>
        )}

        {error ? (
          <p className="error" role="alert">
            The server could not be reached: {error}
          </p>
        ) : null}

        <a className="signin-button" href={START}>
          Sign in with Google
        </a>

        {me?.allowedAccount && !wrongAccount ? (
          <p className="empty small">
            Access is restricted to {me.allowedAccount}. Any other account will be refused.
          </p>
        ) : null}

        {me && !me.capabilities.google ? (
          <p className="blocked" role="status">
            Google sign-in is not configured on the server yet. Ask whoever set this up to check
            GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ENCRYPTION_KEY in the .env file.
          </p>
        ) : null}
      </div>
    </div>
  )
}
