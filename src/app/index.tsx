import { Redirect } from 'expo-router';

// `/` opens the Entries tab (Home).
export default function Index() {
  return <Redirect href="/entries" />;
}
