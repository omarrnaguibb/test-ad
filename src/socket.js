import { io } from "socket.io-client";
import { serverRoute } from "./config.js";

const socket = io(serverRoute);

export default socket;
