export function authoritativeDenial(code: string, status: number) {
  return (
    status === 401 ||
    status === 403 ||
    ["module_unavailable", "workspace_unavailable", "account_closed"].includes(code.toLowerCase())
  );
}
