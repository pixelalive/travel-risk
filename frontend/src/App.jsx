import { useEffect, useState } from "react";

export default function App() {
  const [msg, setMsg] = useState("loading...");
  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/hello")
      .then((r) => r.json())
      .then((d) => setMsg(d.message));
  }, []);
  return <h1>{msg}</h1>;
}
