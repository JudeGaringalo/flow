import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="error-page">
      <h1>Page not found</h1>
      <p>Use the map to find a monitored location.</p>
      <Link href="/">Return to FLOW</Link>
    </main>
  );
}
