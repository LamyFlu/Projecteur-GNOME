#include "button-mappings.h"
#include <QCoreApplication>
#include <KLocalizedString>
#include <stdexcept>
#include <iostream>
#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(#condition); } while (false)
int main(int argc, char** argv) {
  QCoreApplication app(argc, argv);
  KLocalizedString::setApplicationDomain("projecteur");
  using namespace GnomeMappings;
  InputMapConfig config;
  CHECK(parse(QStringLiteral("{\"next\":\"key:Ctrl+L\",\"back-move\":\"volume\"}"), config));
  CHECK(config.size() == 3);
  const auto keyAction = std::dynamic_pointer_cast<KeySequenceAction>(config.at(keyInput(KEY_PAGEDOWN)).action);
  CHECK(keyAction);
  const auto& native = keyAction->keySequence.nativeSequence();
  CHECK(native.size() == 2);
  CHECK(native[0][0] == DeviceInputEvent(EV_KEY, KEY_LEFTCTRL, 1));
  CHECK(native[0][1] == DeviceInputEvent(EV_KEY, KEY_L, 1));
  CHECK(native[1][0] == DeviceInputEvent(EV_KEY, KEY_L, 0));
  CHECK(native[1][1] == DeviceInputEvent(EV_KEY, KEY_LEFTCTRL, 0));
  CHECK(native[1].back().type == EV_SYN);
  const auto previous = config;
  CHECK(!parse(QStringLiteral("{\"next-hold\":\"timer-start\",\"next-move\":\"volume\"}"), config));
  CHECK(config == previous);
  CHECK(keyboard(QStringLiteral("Ctrl+Shift+S, F5")));
  CHECK(!keyboard(QStringLiteral("UnknownKey")));
  CHECK(parse(QStringLiteral("{}"), config) && config.empty());
  std::cout << "PASS: mapping aliases, balanced modifier sequences, conflict rejection and default forwarding\n";
}
