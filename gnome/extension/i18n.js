import GLib from 'gi://GLib';

// Chinese locales share the Traditional Chinese interface; all other locales
// use the English source strings. Respect LANGUAGE/LC_MESSAGES via GLib.
const traditionalChinese = {
    'Laser pointer': '雷射指標',
    'Pointer appearance': '指標外觀',
    'Settings are saved automatically and applied immediately.': '設定會自動儲存，並立即套用到顯示中的指標。',
    'Color': '顏色',
    'Choose pointer color': '選擇指標顏色',
    'Size': '大小',
    'Diameter: 6–96 pixels (adjusted for display scaling).': '直徑：6–96 像素（隨螢幕縮放比例調整）。',
    'Hide the mouse cursor while the dot is visible': '顯示紅點時隱藏滑鼠游標',
    'The mouse cursor returns when the dot disappears.': '紅點消失後自動恢復滑鼠箭頭。',
    'Stay visible after movement (seconds)': '停止移動後的停留秒數',
    '0.1–30 seconds; then hide the dot and restore the mouse cursor.': '0.1–30 秒；時間到後隱藏紅點並恢復滑鼠游標。',
    'Reset appearance': '還原預設外觀',
    'Reset': '還原',
};

export function createTranslator(languages = GLib.get_language_names()) {
    const language = (languages[0] ?? 'en').toLowerCase();
    const isChinese = /^zh(?:[_\-.@]|$)/.test(language);
    return text => isChinese ? traditionalChinese[text] ?? text : text;
}
