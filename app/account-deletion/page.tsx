export const metadata = { title: "Delete your Buzz account" };

export default function AccountDeletionPage() {
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", lineHeight: 1.65 }}>
    <h1>Delete your Buzz account</h1>
    <p>You may request deletion of your Buzz account and associated personal data at any time.</p>
    <h2>In the app</h2>
    <p>Open account settings, choose <strong>Privacy and data</strong>, then choose <strong>Delete account</strong>. Re-authentication may be required to protect your account.</p>
    <h2>Before native account controls launch</h2>
    <p>Use the Buzz support channel and state that you are requesting account deletion. Include only the email address associated with the account. Never send a password, access token, government ID, or other secret.</p>
    <h2>What is deleted</h2>
    <p>Account profile data, favorites, watch preferences, push subscriptions, and other personal data tied to the account will be deleted or irreversibly de-identified, except information that must be retained for fraud prevention, security, legal, or financial-record obligations.</p>
    <p>Deletion requests are verified before processing to prevent unauthorized deletion.</p>
  </main>;
}
