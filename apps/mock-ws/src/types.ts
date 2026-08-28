export interface MockMessage {
  type: "CHAT" | "NOTIFICATION";
  payload: string;
}
