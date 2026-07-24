import { scan } from "@/lib/scan";
import { applyTagAction, pinAction, runScan, unpinAction, updateAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const report = await scan();
  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Rollback Tower</h1>
        <form action={runScan}>
          <button type="submit">Scan now</button>
        </form>
      </header>
      <p>Last scan: {report.scannedAt}</p>
      {report.containers.map((c) => (
        <section key={c.container.id} style={{ borderTop: "1px solid #8884", padding: "0.75rem 0" }}>
          <h2>
            {c.container.name} — <code>{c.container.image}</code>{" "}
            {c.status === "update-available" ? (
              <form action={updateAction} style={{ display: "inline" }}>
                <input type="hidden" name="name" value={c.container.name} />
                <button type="submit">Update to latest</button>
              </form>
            ) : (
              <span>[{c.status}]</span>
            )}
          </h2>
          <p>
            Digest: <code>{c.container.currentDigest?.slice(0, 19) ?? "unknown"}</code>
          </p>
          {c.container.pinned ? (
            <form action={unpinAction} style={{ display: "inline" }}>
              <input type="hidden" name="name" value={c.container.name} />
              <button type="submit">Unpin</button>
            </form>
          ) : (
            <form action={pinAction} style={{ display: "inline" }}>
              <input type="hidden" name="name" value={c.container.name} />
              <button type="submit">Pin</button>
            </form>
          )}
          {c.error ? <p style={{ color: "crimson" }}>Error: {c.error}</p> : null}
          <ul>
            {c.targets.map((t) => (
              <li key={t.tag}>
                <code>{t.tag}</code>
                {t.digest ? <> — {t.digest.slice(0, 19)}</> : null}
                {t.created ? <> — {t.created}</> : null}
                <form action={applyTagAction} style={{ display: "inline" }}>
                  <input type="hidden" name="name" value={c.container.name} />
                  <input type="hidden" name="tag" value={t.tag} />
                  <button type="submit">Apply</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
