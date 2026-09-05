// UI 展示层规范化：保留正式数据原值，只统一面板中的国家称谓。
const NATION_DISPLAY_NAMES = Object.freeze({
  zhao_guo: '昭国',
  yan: '燕国',
  zhao: '赵国',
  chu: '楚国',
  liang: '梁国',
  chen: '陈国'
});

const LEGACY_NAME_TO_ID = Object.freeze({
  昭: 'zhao_guo', 大昭: 'zhao_guo', 昭国: 'zhao_guo',
  燕: 'yan', 大燕: 'yan', 燕国: 'yan',
  赵: 'zhao', 大赵: 'zhao', 赵国: 'zhao',
  楚: 'chu', 大楚: 'chu', 楚国: 'chu',
  梁: 'liang', 大梁: 'liang', 梁国: 'liang',
  陈: 'chen', 大陈: 'chen', 陈国: 'chen'
});

export function getNationDisplayName(value, fallback = '本国') {
  if (!value) return fallback;
  if (typeof value === 'object') {
    if (NATION_DISPLAY_NAMES[value.id]) return NATION_DISPLAY_NAMES[value.id];
    return getNationDisplayName(value.fullName || value.full_name || value.name, fallback);
  }
  const text = String(value).trim();
  const nationId = NATION_DISPLAY_NAMES[text] ? text : LEGACY_NAME_TO_ID[text];
  return NATION_DISPLAY_NAMES[nationId] || text || fallback;
}

export { NATION_DISPLAY_NAMES };
