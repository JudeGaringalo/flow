'use client';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><h1>FLOW could not load.</h1><p>No current flood condition is confirmed. Try reconnecting before relying on cached information.</p><button className="primary-btn" onClick={reset}>Try again</button></main>;
}
