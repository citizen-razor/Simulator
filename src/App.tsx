import { signOut, useAuth } from "./lib/auth";
import { useRoute } from "./router";
import { Redirect } from "./components/Redirect";
import Assignments from "./pages/Assignments";
import Create from "./pages/Create";
import Editor from "./pages/Editor";
import Leaderboard from "./pages/Leaderboard";
import Libraries from "./pages/Libraries";
import Library from "./pages/Library";
import MyTraining from "./pages/MyTraining";
import People from "./pages/People";
import Performance from "./pages/Performance";
import Quality from "./pages/Quality";
import Player from "./pages/Player";
import Progress from "./pages/Progress";
import Results from "./pages/Results";
import { Account, SignIn, Setup } from "./pages/SignIn";

/**
 * The app shell: sign-in gate, a menu that depends on your roles, and the pages.
 * The server enforces every permission; hiding things here just keeps the menu relevant.
 */
export default function App() {
  const auth = useAuth();
  const route = useRoute();
  const [page, id] = route.path;

  if (auth.loading) return <div className="page muted">Loading…</div>;
  if (auth.setupNeeded) return <Setup />;
  if (!auth.user) return <SignIn />;

  const me = auth.user;
  const canSeeOthers = auth.isAdmin || auth.isLeader;
  const allowed: Record<string, boolean> = {
    "": true,
    my: true,
    leaderboard: true,
    account: true,
    play: true,
    progress: true, // the page itself limits you to who you may see
    new: auth.isBuilder,
    edit: auth.isBuilder,
    performance: auth.isBuilder,
    quality: auth.isBuilder,
    assignments: canSeeOthers,
    results: canSeeOthers,
    libraries: auth.isBuilder, // Builders view; only Admin-Builders edit
    people: auth.isAdmin,
  };
  const full = page === "play" || page === "edit";
  const nav = (href: string, label: string, key: string) => (
    <a href={href} className={page === key ? "active" : ""}>{label}</a>
  );

  return (
    <div className={full ? "app app-full" : "app"}>
      <header className="topnav">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden>◧</span> Simulator
        </a>
        <nav>
          {nav("#/", "Library", "")}
          {nav("#/my", "My training", "my")}
          {nav("#/leaderboard", "Leaderboard", "leaderboard")}
          {canSeeOthers ? nav("#/progress", auth.isAdmin ? "Progress" : "My team", "progress") : nav(`#/progress/${me.id}`, "My progress", "progress")}
          {auth.isBuilder && nav("#/new", "Create", "new")}
          {canSeeOthers && nav("#/assignments", "Assignments", "assignments")}
          {canSeeOthers && nav("#/results", "Results", "results")}
          {auth.isBuilder && nav("#/performance", "Performance", "performance")}
          {auth.isBuilder && nav("#/quality", "Quality", "quality")}
          {(auth.isAdmin || auth.isBuilder) && nav("#/libraries", "Libraries", "libraries")}
          {auth.isAdmin && nav("#/people", "People", "people")}
        </nav>
        <span className="spacer" />
        <div className="user-menu">
          <a href="#/account" className={page === "account" ? "active" : ""} title={auth.org}>{me.name}</a>
          <button className="link-btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>
      <main>
        {allowed[page ?? ""] === false ? (
          // No "access denied" pages: anything you can't use is hidden, and a stale link just goes home.
          <Redirect to="#/" />
        ) : page === "new" ? (
          <Create />
        ) : page === "edit" && id ? (
          <Editor key={id} id={id} />
        ) : page === "play" && id ? (
          <Player key={`${id}?${route.query.toString()}`} id={id} query={route.query} />
        ) : page === "my" ? (
          <MyTraining />
        ) : page === "leaderboard" ? (
          <Leaderboard />
        ) : page === "assignments" ? (
          <Assignments />
        ) : page === "libraries" ? (
          <Libraries tab={id} personaId={route.query.get("persona") ?? undefined} />
        ) : page === "progress" ? (
          <Progress key={id ?? ""} userId={id} />
        ) : page === "results" ? (
          <Results simulationId={id} />
        ) : page === "quality" ? (
          <Quality key={id ?? ""} simulationId={id} />
        ) : page === "performance" ? (
          <Performance key={id ?? ""} simulationId={id} />
        ) : page === "people" ? (
          <People />
        ) : page === "account" ? (
          <Account />
        ) : (
          <Library />
        )}
      </main>
    </div>
  );
}

