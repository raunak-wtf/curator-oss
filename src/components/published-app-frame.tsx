type PublishedAppFrameProps = {
  title: string;
  runtimeUrl: string;
  /** Shows the small "Edit with Curator" badge in the bottom-right corner. */
  showBadge?: boolean;
  /** Where the badge goes: the remix page when public remixing is on, otherwise the Curator home page. */
  badgeHref?: string;
};

export function PublishedAppFrame({ title, runtimeUrl, showBadge = false, badgeHref = "/" }: PublishedAppFrameProps) {
  return (
    <main className="published-app-shell">
      <iframe
        title={title}
        src={runtimeUrl}
        allow="camera; clipboard-read; clipboard-write; display-capture; fullscreen; geolocation; microphone"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {showBadge ? (
        <a href={badgeHref} target="_blank" rel="noopener" className="curator-badge" aria-label="Edit with Curator (opens in a new tab)">
          {/* The badge sits outside the app's iframe, so the published app's code can't hide or restyle it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cognix-logo-192.png" alt="" width={12} height={12} />
          Edit with Curator
        </a>
      ) : null}
      <noscript>This published app requires JavaScript.</noscript>
    </main>
  );
}
