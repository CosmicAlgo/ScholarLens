// Random per-browser id for the API's daily AI-report quota. Not linked to any personal data.
export function clientId(): string {
  try {
    let id = localStorage.getItem("sl_client_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("sl_client_id", id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}
