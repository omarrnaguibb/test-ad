import { BrowserRouter, Route, Routes } from "react-router-dom";
import Main_Page from "./Main_Page";
import Login from "./Login";

export const serverRoute = 'http://localhost:8080'
// export const serverRoute = "https://t-ser-production.up.railway.app";
export const token = localStorage.getItem("token");
function App() {
  return (
    <div>
      <BrowserRouter>
        <Routes>
          <Route element={<Main_Page />} path="/" />
          <Route element={<Login />} path="/login" />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
