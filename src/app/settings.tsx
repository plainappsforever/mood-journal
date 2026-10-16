import { Redirect } from 'expo-router';

// Old template route: settings live under More → Appearance.
export default function Settings() {
  return <Redirect href="/appearance" />;
}
