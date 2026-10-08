import {createTranslator} from '../extension/i18n.js';

for (const locale of ['zh_TW.UTF-8', 'zh_HK', 'zh_MO', 'zh_CN.UTF-8',
    'zh_SG', 'zh-Hant', 'zh-Hans', 'zh']) {
    if (createTranslator([locale])('Color') !== '顏色')
        throw new Error(`Expected Traditional Chinese for ${locale}`);
}
for (const locale of ['en_US.UTF-8', 'fr_FR.UTF-8', 'de_DE', 'ja_JP', 'C', 'C.UTF-8']) {
    if (createTranslator([locale, 'zh_TW'])('Color') !== 'Color')
        throw new Error(`Expected English for ${locale}`);
}
if (createTranslator([])('Color') !== 'Color')
    throw new Error('Missing locale must fall back to English');
if (createTranslator(['zh_TW'])('Unknown string') !== 'Unknown string')
    throw new Error('Unknown strings must fall back to English');
print('PASS: Chinese locales use Traditional Chinese; other locales use English');
