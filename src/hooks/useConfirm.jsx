import { useState, useCallback, useRef, createContext, useContext } from "react";
import { useFocusTrap } from "./useFocusTrap.js";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const [cancelHover, setCancelHover] = useState(false);
  const [confirmHover, setConfirmHover] = useState(false);

  const confirm = useCallback((message, opts = {}) => {
    const options = typeof opts === "string"
      ? { title: opts }
      : opts;
    const { title = "Confirm", danger = false, confirmLabel = "Confirm", cancelLabel = "Cancel" } = options;
    return new Promise((resolve) => {
      setState({ message, title, danger, confirmLabel, cancelLabel, resolve });
    });
  }, []);

  const handleResult = (result) => {
    state?.resolve(result);
    setState(null);
  };
  const modalRef = useRef(null);
  useFocusTrap(modalRef, !!state);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.65)",
          }}
        >
          <div
            ref={modalRef}
            style={{
              background: "var(--card)",
              border: "1px solid #1e2338",
              borderRadius: "14px",
              padding: "24px",
              width: "100%",
              maxWidth: "360px",
              margin: "0 16px",
              boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
            }}
          >
            <h3
              id="confirm-title"
              style={{
                color: "var(--text)",
                fontSize: "15px",
                fontWeight: 600,
                margin: "0 0 8px 0",
              }}
            >
              {state.title}
            </h3>
            <p
              id="confirm-message"
              style={{
                color: "var(--text-2)",
                fontSize: "13px",
                lineHeight: 1.6,
                margin: "0 0 24px 0",
              }}
            >
              {state.message}
            </p>
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => handleResult(false)}
                onMouseEnter={() => setCancelHover(true)}
                onMouseLeave={() => setCancelHover(false)}
                style={{
                  border: "1px solid #1e2338",
                  color: "var(--text-2)",
                  background: cancelHover ? "var(--card-hi)" : "transparent",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                {state.cancelLabel}
              </button>
              <button
                onClick={() => handleResult(true)}
                onMouseEnter={() => setConfirmHover(true)}
                onMouseLeave={() => setConfirmHover(false)}
                style={{
                  background: state.danger
                    ? (confirmHover ? "var(--red)" : "#ef4444")
                    : (confirmHover ? "var(--accent)" : "#3b82f6"),
                  color: "white",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook export pattern
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return { confirm: ctx.confirm };
}
