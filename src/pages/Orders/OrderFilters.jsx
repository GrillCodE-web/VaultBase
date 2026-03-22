import React from "react";
import { useLang } from "../../hooks/useLang";

export function OrderFilters({ filter, setFilter, load, searchInput, setSearchInput, shopOptions }) {
  const { t } = useLang();

  const setFilterVal = (key, val) => {
    const f = { ...filter, [key]: val };
    setFilter(f);
    load(1, f);
  };

  const handleReset = () => {
    const f = { status: "", shop_id: null, date_from: "", date_to: "", search: "" };
    setFilter(f);
    load(1, f);
  };

  return (
    <div className="filters">
      <button
        className={`flt${!filter.status ? " active" : ""}`}
        onClick={() => setFilterVal("status", "")}
        data-shortcut="refresh"
      >
        {t("filter_all")}
      </button>
      <button
        className={`flt${filter.status === "pending" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "pending")}
      >
        {t("status_pending")}
      </button>
      <button
        className={`flt${filter.status === "processing" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "processing")}
      >
        {t("status_processing")}
      </button>
      <button
        className={`flt${filter.status === "shipped" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "shipped")}
      >
        {t("status_shipped")}
      </button>
      <button
        className={`flt${filter.status === "in_transit" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "in_transit")}
      >
        {t("status_in_transit")}
      </button>
      <button
        className={`flt${filter.status === "delivered" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "delivered")}
      >
        {t("status_delivered")}
      </button>
      <button
        className={`flt${filter.status === "declined" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "declined")}
      >
        {t("status_declined")}
      </button>
      <button
        className={`flt${filter.status === "cancelled" ? " active" : ""}`}
        onClick={() => setFilterVal("status", "cancelled")}
      >
        {t("status_cancelled")}
      </button>
      <select
        value={filter.shop_id || ""}
        onChange={(e) => {
          const v = e.target.value ? parseInt(e.target.value) : null;
          setFilterVal("shop_id", v);
        }}
        className="inline-select"
      >
        <option value="">{t("cc_filter_status").replace("Statuses","Shops")}</option>
        {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input
        type="date"
        value={filter.date_from}
        onChange={(e) => setFilterVal("date_from", e.target.value)}
        className="inline-select px-2 py-[5px]"
        title={t("col_date")}
      />
      <input
        type="date"
        value={filter.date_to}
        onChange={(e) => setFilterVal("date_to", e.target.value)}
        className="inline-select px-2 py-[5px]"
        title={t("col_date")}
      />
      <input
        className="search-box"
        placeholder="order number, profile..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && load(1, { ...filter, search: searchInput })}
      />
      {(filter.status || filter.search || filter.date_from || filter.date_to || filter.shop_id) && (
        <button className="btn btn-ghost btn-sm" onClick={handleReset}>
          Reset
        </button>
      )}
    </div>
  );
}
