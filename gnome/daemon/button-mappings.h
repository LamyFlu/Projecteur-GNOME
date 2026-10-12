#pragma once
#include "deviceinput.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <linux/input.h>

namespace GnomeMappings {
// Use the upstream mapper's shell-action dispatch path; no serialized Plasma
// configuration is changed. The bridge interprets this subtype itself.
struct ShellAction final : CyclePresetsAction {
  explicit ShellAction(QString value) : name(std::move(value)) {}
  QString name;
};

inline KeyEventSequence keyInput(uint16_t key) {
  return {{{EV_KEY, key, 1}}, {{EV_KEY, key, 0}}};
}

inline uint16_t linuxKey(int qt) {
  const uint16_t letters[] = {KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F, KEY_G,
    KEY_H, KEY_I, KEY_J, KEY_K, KEY_L, KEY_M, KEY_N, KEY_O, KEY_P, KEY_Q,
    KEY_R, KEY_S, KEY_T, KEY_U, KEY_V, KEY_W, KEY_X, KEY_Y, KEY_Z};
  if (qt >= Qt::Key_A && qt <= Qt::Key_Z) return letters[qt - Qt::Key_A];
  if (qt >= Qt::Key_1 && qt <= Qt::Key_9) return KEY_1 + qt - Qt::Key_1;
  if (qt >= Qt::Key_F1 && qt <= Qt::Key_F10) return KEY_F1 + qt - Qt::Key_F1;
  switch (qt) {
    case Qt::Key_0: return KEY_0;
    case Qt::Key_F11: return KEY_F11;
    case Qt::Key_F12: return KEY_F12;
    case Qt::Key_Space: return KEY_SPACE;
    case Qt::Key_Tab: return KEY_TAB;
    case Qt::Key_Return: case Qt::Key_Enter: return KEY_ENTER;
    case Qt::Key_Escape: return KEY_ESC;
    case Qt::Key_Backspace: return KEY_BACKSPACE;
    case Qt::Key_Delete: return KEY_DELETE;
    case Qt::Key_Insert: return KEY_INSERT;
    case Qt::Key_Home: return KEY_HOME;
    case Qt::Key_End: return KEY_END;
    case Qt::Key_PageUp: return KEY_PAGEUP;
    case Qt::Key_PageDown: return KEY_PAGEDOWN;
    case Qt::Key_Left: return KEY_LEFT;
    case Qt::Key_Right: return KEY_RIGHT;
    case Qt::Key_Up: return KEY_UP;
    case Qt::Key_Down: return KEY_DOWN;
    case Qt::Key_Minus: return KEY_MINUS;
    case Qt::Key_Equal: return KEY_EQUAL;
    case Qt::Key_Comma: return KEY_COMMA;
    case Qt::Key_Period: return KEY_DOT;
    case Qt::Key_Slash: return KEY_SLASH;
    default: return 0;
  }
}

inline std::shared_ptr<Action> keyboard(const QString& text) {
  if (text.isEmpty() || text.size() > 128) return {};
  const auto sequence = QKeySequence::fromString(text, QKeySequence::PortableText);
  if (sequence.isEmpty()) return {};
  KeyEventSequence events;
  std::vector<int> qtKeys;
  std::vector<uint16_t> modifiers;
  for (int i = 0; i < sequence.count(); ++i) {
    const auto combination = sequence[i];
    const uint16_t code = linuxKey(combination.key());
    const auto flags = combination.keyboardModifiers();
    if (!code || (flags & ~(Qt::ControlModifier | Qt::AltModifier | Qt::ShiftModifier | Qt::MetaModifier))) return {};
    KeyEvent down, up;
    uint16_t native = 0;
    for (const auto& item : std::vector<std::tuple<Qt::KeyboardModifier,uint16_t,uint16_t>>{
        {Qt::ControlModifier, KEY_LEFTCTRL, NativeKeySequence::LeftCtrl},
        {Qt::AltModifier, KEY_LEFTALT, NativeKeySequence::LeftAlt},
        {Qt::ShiftModifier, KEY_LEFTSHIFT, NativeKeySequence::LeftShift},
        {Qt::MetaModifier, KEY_LEFTMETA, NativeKeySequence::LeftMeta}}) {
      if (!(flags & std::get<0>(item))) continue;
      down.emplace_back(EV_KEY, std::get<1>(item), 1);
      up.insert(up.begin(), DeviceInputEvent{EV_KEY, std::get<1>(item), 0});
      native |= std::get<2>(item);
    }
    down.emplace_back(EV_KEY, code, 1); down.emplace_back(EV_SYN, SYN_REPORT, 0);
    up.insert(up.begin(), DeviceInputEvent{EV_KEY, code, 0}); up.emplace_back(EV_SYN, SYN_REPORT, 0);
    events.push_back(down); events.push_back(up);
    qtKeys.push_back(combination.key()); modifiers.push_back(native);
  }
  return std::make_shared<KeySequenceAction>(NativeKeySequence(qtKeys, std::move(modifiers), std::move(events)));
}

inline bool parse(const QString& json, InputMapConfig& result) {
  if (json.size() > 8192) return false;
  QJsonParseError error;
  const auto doc = QJsonDocument::fromJson(json.toUtf8(), &error);
  if (error.error != QJsonParseError::NoError || !doc.isObject()) return false;
  const auto object = doc.object();
  const QStringList inputs{"next", "back", "next-hold", "back-hold", "next-move", "back-move"};
  InputMapConfig config;
  for (auto it = object.begin(); it != object.end(); ++it) {
    if (!inputs.contains(it.key()) || !it.value().isString()) return false;
    const auto action = it.value().toString();
    if (action == QStringLiteral("default")) continue;
    const bool move = it.key().endsWith(QStringLiteral("-move"));
    std::shared_ptr<Action> mapped;
    if (action.startsWith(QStringLiteral("key:")) && !move) mapped = keyboard(action.mid(4));
    else if (QStringList{"next-preset", "previous-preset", "toggle-effect", "next-effect", "timer-start", "timer-reset"}.contains(action) && !move)
      mapped = std::make_shared<ShellAction>(action);
    else if (action == QStringLiteral("scroll-up") && !move) { auto a = std::make_shared<ScrollVerticalAction>(); a->param = 1; mapped = a; }
    else if (action == QStringLiteral("scroll-down") && !move) { auto a = std::make_shared<ScrollVerticalAction>(); a->param = -1; mapped = a; }
    else if (action == QStringLiteral("scroll-left") && !move) { auto a = std::make_shared<ScrollHorizontalAction>(); a->param = -1; mapped = a; }
    else if (action == QStringLiteral("scroll-right") && !move) { auto a = std::make_shared<ScrollHorizontalAction>(); a->param = 1; mapped = a; }
    else if (action == QStringLiteral("volume-up") && !move) { auto a = std::make_shared<VolumeControlAction>(); a->param = 1; mapped = a; }
    else if (action == QStringLiteral("volume-down") && !move) { auto a = std::make_shared<VolumeControlAction>(); a->param = -1; mapped = a; }
    else if (action == QStringLiteral("scroll-vertical") && move) mapped = GlobalActions::scrollVertical();
    else if (action == QStringLiteral("scroll-horizontal") && move) mapped = GlobalActions::scrollHorizontal();
    else if (action == QStringLiteral("volume") && move) mapped = GlobalActions::volumeControl();
    if (!mapped) return false;
    const bool next = it.key().startsWith(QStringLiteral("next"));
    if (it.key() == QStringLiteral("next") || it.key() == QStringLiteral("back")) {
      for (const uint16_t code : next ? std::vector<uint16_t>{KEY_RIGHT, KEY_PAGEDOWN} : std::vector<uint16_t>{KEY_LEFT, KEY_PAGEUP})
        config.emplace(keyInput(code), MappedAction{mapped});
    } else {
      const auto key = move ? (next ? SpecialKeys::Key::NextHoldMove : SpecialKeys::Key::BackHoldMove)
        : (next ? SpecialKeys::Key::NextHold : SpecialKeys::Key::BackHold);
      config.emplace(SpecialKeys::eventSequenceInfo(key).keyEventSeq, MappedAction{mapped});
    }
  }
  // Do not run a hold action and a hold-move action on the same gesture.
  for (const auto& button : {QStringLiteral("next"), QStringLiteral("back")}) {
    const auto hold = object.value(button + QStringLiteral("-hold")).toString(QStringLiteral("default"));
    const auto move = object.value(button + QStringLiteral("-move")).toString(QStringLiteral("default"));
    if (hold != QStringLiteral("default") && move != QStringLiteral("default")) return false;
  }
  result = std::move(config);
  return true;
}
} // namespace GnomeMappings
