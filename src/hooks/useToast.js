import { useState, useCallback, createContext, useContext, useRef } from "react";

const ToastContext = createContext(null);

let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ message, type = "info", duration = 3500 }) => {
      const id = ++_id;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => remove(id), duration);
    },
    [remove]
  );

  const success = useCallback((msg) => toast({ message: msg, type: "success" }), [toast]);
  const error   = useCallback((msg) => toast({ message: msg, type: "error" }),   [toast]);
  const warn    = useCallback((msg) => toast({ message: msg, type: "warn" }),    [toast]);
  const info    = useCallback((msg) => toast({ message: msg, type: "info" }),    [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, warn, info }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => remove(t.id)}
            className={`pointer-events-auto px-4 py-3 rounded-lg shadow-xl text-sm font-medium
              cursor-pointer transition-all duration-200
              ${t.type === "success" ? "bg-accent-green   text-white" : ""}
              ${t.type === "error"   ? "bg-accent-red     text-white" : ""}
              ${t.type === "warn"    ? "bg-accent-yellow  text-black" : ""}
              ${t.type === "info"    ? "bg-accent-blue    text-white" : ""}
            `}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
