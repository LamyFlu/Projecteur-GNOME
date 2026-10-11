// This file is part of Projecteur - see LICENSE.md.
#pragma once
#include <linux/input.h>
#include <cstdint>
#include <vector>

// Devices may put MSC_SCAN or buttons before REL_X/Y. Keep mouse movement
// separate from keyboard/button mapping without dropping a mixed frame.
struct PointerFrame {
  int x = 0;
  int y = 0;
  std::vector<input_event> relative;
  std::vector<input_event> other;
};
inline PointerFrame splitPointerFrame(const input_event* events, size_t count)
{
  PointerFrame result;
  for (size_t i = 0; i < count; ++i) {
    const auto& event = events[i];
    if (event.type == EV_SYN) { continue; }
    if (event.type == EV_REL) {
      result.relative.push_back(event);
      if (event.code == REL_X) { result.x += event.value; }
      if (event.code == REL_Y) { result.y += event.value; }
    } else {
      result.other.push_back(event);
    }
  }
  const input_event sync{{}, EV_SYN, SYN_REPORT, 0};
  if (!result.relative.empty()) { result.relative.push_back(sync); }
  if (!result.other.empty()) { result.other.push_back(sync); }
  return result;
}

// Track forwarded presses so a disabled click cannot leave an unmatched
// release, and enabling during a physical hold cannot synthesize a click.
inline std::vector<input_event> filterPointerClicks(const input_event* events,
    size_t count, bool enabled, bool& forwardedPress)
{
  std::vector<input_event> result;
  for (size_t i = 0; i < count; ++i) {
    const auto& event = events[i];
    if (event.type == EV_KEY && event.code == BTN_LEFT) {
      if (event.value == 1) {
        forwardedPress = enabled;
        if (!forwardedPress) { continue; }
      } else if (event.value == 0) {
        const bool forward = forwardedPress;
        forwardedPress = false;
        if (!forward) { continue; }
      } else if (!forwardedPress) {
        continue;
      }
    }
    result.push_back(event);
  }
  return result;
}

// HID++ 0x1b04: state bits are followed by their valid bits.
// An off command must send valid bits even though the state bits are clear.
inline uint8_t pointerReportingFlags(bool enabled, bool rawXY)
{
  const uint8_t valid = rawXY ? 0x22 : 0x02;
  const uint8_t state = rawXY ? 0x11 : 0x01;
  return valid | (enabled ? state : 0);
}
