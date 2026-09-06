import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createReactiveDataClient } from "../../src/client/index.js";
import { ReactiveDataProvider, useLiveQuery } from "../../src/react/index.js";
import type { AppApi } from "../bun/index.js";
import type { TodoFilter } from "../shared.js";
import "./style.css";

const { api, runtime } = createReactiveDataClient<AppApi>();
function App() {
  const [filter, setFilter] = useState<TodoFilter>("all");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const todos = useLiveQuery(api.query.todos, { filter });
  const act = async (action: Promise<unknown>) => {
    setError("");
    try {
      await action;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => {
    (window as any).__erdNativeSmoke = {
      add: (value: string) => api.mutation.addTodo({ title: value }),
      toggleFirst: () =>
        todos.status === "success" && todos.data[0]
          ? api.mutation.toggleTodo({ id: todos.data[0].id })
          : Promise.reject(new Error("No todo to toggle")),
      deleteFirst: () =>
        todos.status === "success" && todos.data[0]
          ? api.mutation.deleteTodo({ id: todos.data[0].id })
          : Promise.reject(new Error("No todo to delete")),
      rollback: () => api.mutation.failAfterWrite({}).catch(() => undefined),
      setFilter,
      report: (stage: string) =>
        api.mutation.recordNativeSmoke({
          stage,
          windowId: Number((window as any).__electrobunWindowId),
          payload: {
            filter,
            status: todos.status,
            refreshCount: todos.refreshCount,
            rows: todos.status === "success" ? todos.data : [],
          },
        }),
      snapshot: () => ({
        windowId: Number((window as any).__electrobunWindowId),
        filter,
        status: todos.status,
        refreshCount: todos.refreshCount,
        rows: todos.status === "success" ? todos.data : [],
        text: document.body.innerText,
      }),
    };
    return () => {
      delete (window as any).__erdNativeSmoke;
    };
  }, [filter, todos]);
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">ELECTROBUN · SQLITE</p>
          <h1>Things worth doing.</h1>
        </div>
        <button
          className="secondary"
          onClick={() => void act(api.mutation.openWindow({}))}
        >
          Open another window
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = title;
          setTitle("");
          void act(api.mutation.addTodo({ title: value }));
        }}
      >
        <input
          aria-label="New todo"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs your attention?"
        />
        <button>Add</button>
      </form>
      <nav>
        {(["all", "active", "completed"] as const).map((item) => (
          <button
            key={item}
            className={filter === item ? "active" : "secondary"}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {todos.status === "loading" && <p>Loading…</p>}
      {todos.status === "error" && <p role="alert">{todos.error.message}</p>}
      {todos.status === "success" && (
        <>
          <p className="counter">
            Refresh #{todos.refreshCount} · {todos.data.length} visible
          </p>
          <ul>
            {todos.data.map((todo) => (
              <li key={todo.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!todo.done}
                    onChange={() =>
                      void act(api.mutation.toggleTodo({ id: todo.id }))
                    }
                  />
                  <span className={todo.done ? "done" : ""}>{todo.title}</span>
                </label>
                <button
                  className="delete"
                  aria-label={`Delete ${todo.title}`}
                  onClick={() =>
                    void act(api.mutation.deleteTodo({ id: todo.id }))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
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
