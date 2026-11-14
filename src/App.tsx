import { useRoute } from "./router";
import Create from "./pages/Create";
import Editor from "./pages/Editor";
import Library from "./pages/Library";
import Player from "./pages/Player";
import Progress from "./pages/Progress";
import Results from "./pages/Results";

export default function App() {
  const route = useRoute();
  const [page, id] = route.path;
  const full = page === "play" || page === "edit";
  return (
    <div className={full ? "app app-full" : "app"}>
      <header className="topnav">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden>◧</span> Simulator
        </a>
        <nav>
          <a href="#/" className={!page ? "active" : ""}>Library</a>
          <a href="#/new" className={page === "new" ? "active" : ""}>Create</a>
          <a href="#/progress" className={page === "progress" ? "active" : ""}>Progress</a>
          <a href="#/results" className={page === "results" ? "active" : ""}>Results</a>
        </nav>
      </header>
      <main>
        {page === "new" ? (
          <Create />
        ) : page === "edit" && id ? (
          <Editor key={id} id={id} />
        ) : page === "play" && id ? (
          <Player key={`${id}?${route.query.toString()}`} id={id} query={route.query} />
        ) : page === "progress" ? (
          <Progress key={id ?? ""} name={id} />
        ) : page === "results" ? (
          <Results simulationId={id} />
        ) : (
          <Library />
        )}
      </main>
    </div>
  );
}
