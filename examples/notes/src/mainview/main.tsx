import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, runtime } from "./client.js";
import {
  ReactiveDataProvider,
  useLiveQuery,
} from "@jugyo/electrobun-reactive-data/react";
import "./style.css";
function App() {
  const [search, setSearch] = useState("");
  const notes = useLiveQuery(api.query.notes, { search });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const rows = notes.status === "success" ? notes.data : [];
  return (
    <main>
      <header>
        <p>REACTIVE SQLITE</p>
        <h1>Notes</h1>
      </header>
      <input
        aria-label="Search notes"
        value={search}
        onInput={(event) => setSearch(event.currentTarget.value)}
        placeholder="Search notes…"
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void api.mutation.create({ title, body });
          setTitle("");
          setBody("");
        }}
      >
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <textarea
          aria-label="Body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a note…"
        />
        <button>Create note</button>
      </form>
      {notes.status === "loading" && <p>Loading…</p>}
      {notes.status === "error" && <p role="alert">{notes.error.message}</p>}
      <p className="meta">Refresh #{notes.refreshCount}</p>
      <section>
        {rows.map((note) => (
          <article key={note.id}>
            <input
              value={note.title}
              onChange={(e) =>
                void api.mutation.update({
                  id: note.id,
                  title: e.target.value,
                  body: note.body,
                })
              }
            />
            <textarea
              value={note.body}
              onChange={(e) =>
                void api.mutation.update({
                  id: note.id,
                  title: note.title,
                  body: e.target.value,
                })
              }
            />
            <button onClick={() => void api.mutation.remove({ id: note.id })}>
              Delete
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReactiveDataProvider runtime={runtime}>
      <App />
    </ReactiveDataProvider>
  </StrictMode>,
);
