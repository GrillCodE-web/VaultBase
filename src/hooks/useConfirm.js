import { useState, useCallback, createContext, useContext } from "react";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  // state = { message, title, resolve }

  const confirm = useCallback((message, title = "Confirm") => {
    return new Promise((resolve) => {
      setState({ message, title, resolve });
    });
  }, []);

  const handleResult = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-card border border-border-default rounded-xl p-6 shadow-2xl w-full max-w-sm mx-4">
            <h3 className="text-text-primary font-semibold text-base mb-2">{state.title}</h3>
            <p className="text-text-secondary text-sm mb-6">{state.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => handleResult(false)}
                className="px-4 py-2 rounded-lg text-sm text-text-secondary
                           border border-border-default hover:bg-bg-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleResult(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white
                           bg-accent-red hover:bg-red-600 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx.confirm;
}
