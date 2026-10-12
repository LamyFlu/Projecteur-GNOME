import {createTranslator} from '../extension/i18n.js';

const labels = new Map([
    ['Preview effects', '預覽效果'],
    ['Export all', '匯出全部'],
    ['Button actions', '按鍵自訂'],
    ['Pixel grid', '像素格'],
    ['Presentation timer', '簡報倒數'],
    ['Effect presets', '效果設定組合'],
    ['Connected presenters', '已連接的簡報器'],
    ['Always show the pointer effect', '永久顯示指示效果'],
    ['Current effect', '目前效果'],
    ['Display behavior', '顯示行為'],
    ['Presenter controls', '簡報器操作'],
    ['Center on the remembered monitor each time the pointer button is pressed', '每次按下指示鍵時從上次螢幕中央開始'],
    ['Open preferences', '開啟完整設定'],
    ['Enable at least one effect first.', '請先啟用其中一個指示效果。'],
    ['Double-click to switch effects', '快速點兩下切換效果'],
    ['Allow presenter mouse clicks', '允許簡報器滑鼠點擊'],
]);

for (const locale of ['zh_TW.UTF-8', 'zh_HK', 'zh_MO', 'zh_CN.UTF-8',
    'zh_SG', 'zh-Hant', 'zh-Hans', 'zh']) {
    if (createTranslator([locale])('Color') !== '顏色')
        throw new Error(`Expected Traditional Chinese for ${locale}`);
    for (const [english, chinese] of labels) {
        if (createTranslator([locale])(english) !== chinese)
            throw new Error(`Missing Chinese translation for ${english} in ${locale}`);
    }
}
for (const locale of ['en_US.UTF-8', 'fr_FR.UTF-8', 'de_DE', 'ja_JP', 'C', 'C.UTF-8']) {
    if (createTranslator([locale, 'zh_TW'])('Color') !== 'Color')
        throw new Error(`Expected English for ${locale}`);
    for (const english of labels.keys()) {
        if (createTranslator([locale, 'zh_TW'])(english) !== english)
            throw new Error(`Expected English label ${english} in ${locale}`);
    }
}
if (createTranslator([])('Color') !== 'Color')
    throw new Error('Missing locale must fall back to English');
if (createTranslator(['zh_TW'])('Unknown string') !== 'Unknown string')
    throw new Error('Unknown strings must fall back to English');
print('PASS: Chinese locales use Traditional Chinese; other locales use English');
