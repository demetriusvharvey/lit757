export const metadata = { title: "Privacy | Buzz" };

export default function PrivacyPage() {
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", lineHeight: 1.65 }}>
    <h1>Buzz Privacy Notice</h1>
    <p><strong>Last updated:</strong> July 23, 2026</p>
    <p>Buzz helps people discover nearby venues and events. We minimize personal data and use it only to provide, secure, improve, and measure the service.</p>
    <h2>Data we may process</h2>
    <p>Account details you provide, favorites and notification preferences, approximate or precise location only when you grant permission, device and push-subscription identifiers, and limited usage and security logs.</p>
    <h2>How data is used</h2>
    <p>To show relevant places and events, deliver requested alerts, prevent abuse, maintain service reliability, and understand aggregate product performance. Buzz does not sell personal information.</p>
    <h2>Third-party services</h2>
    <p>Buzz may use infrastructure, mapping, authentication, event-data, analytics, and notification providers. Each provider receives only the information needed to perform its function.</p>
    <h2>Location</h2>
    <p>Location access is optional. Buzz should request foreground access only unless a future feature clearly explains why broader access is needed. You can revoke access in your device settings.</p>
    <h2>Retention and deletion</h2>
    <p>Data is retained only while needed for the service, security, legal obligations, or legitimate operational purposes. You may request account and associated personal-data deletion from the account settings or support channel.</p>
    <h2>Children</h2>
    <p>Buzz is not directed to children under 13 and does not knowingly collect their personal information.</p>
    <h2>Contact</h2>
    <p>Use the support page in Buzz for privacy questions, data access, correction, or deletion requests.</p>
  </main>;
}
