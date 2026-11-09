import App from "./App.jsx";
const read = id => JSON.parse(document.getElementById(id).textContent);
const MODEL = read("model-data"), EVAL = read("eval-data");
ReactDOM.createRoot(document.getElementById("root")).render(<App MODEL={MODEL} EVAL={EVAL} />);
