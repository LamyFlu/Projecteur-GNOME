#include "pointerframe.h"
#include <cassert>
int main()
{
  assert(pointerReportingFlags(true, false) == 0x03);
  assert(pointerReportingFlags(false, false) == 0x02);
  assert(pointerReportingFlags(true, true) == 0x33);
  assert(pointerReportingFlags(false, true) == 0x22);
  const input_event mixed[] = {{{}, EV_MSC, MSC_SCAN, 123},
    {{}, EV_KEY, KEY_RIGHT, 1}, {{}, EV_REL, REL_X, 5},
    {{}, EV_REL, REL_Y, -3}, {{}, EV_SYN, SYN_REPORT, 0}};
  const auto frame = splitPointerFrame(mixed, 5);
  assert(frame.x == 5 && frame.y == -3);
  assert(frame.relative.size() == 3 && frame.other.size() == 3);
  assert(frame.other[1].code == KEY_RIGHT);
  assert(frame.relative.back().type == EV_SYN && frame.other.back().type == EV_SYN);
  const input_event click[] = {{{}, EV_KEY, BTN_LEFT, 1},
    {{}, EV_REL, REL_X, 4}, {{}, EV_KEY, KEY_RIGHT, 1},
    {{}, EV_KEY, BTN_LEFT, 0}, {{}, EV_SYN, SYN_REPORT, 0}};
  bool held = false;
  const auto disabled = filterPointerClicks(click, 5, false, held);
  assert(!held && disabled.size() == 3);
  assert(disabled[0].type == EV_REL && disabled[1].code == KEY_RIGHT);
  const auto enabled = filterPointerClicks(click, 5, true, held);
  assert(!held && enabled.size() == 5);
  const auto press = filterPointerClicks(click, 1, true, held);
  assert(held && press.size() == 1);
  // A forwarded press must have a matching release even if policy changes.
  const auto release = filterPointerClicks(click + 3, 1, false, held);
  assert(!held && release.size() == 1);
  filterPointerClicks(click, 1, false, held);
  assert(!held);
  assert(filterPointerClicks(click + 3, 1, true, held).empty());
  const input_event wheel[] = {{{}, EV_REL, REL_WHEEL, 1}, {{}, EV_SYN, SYN_REPORT, 0}};
  const auto scroll = splitPointerFrame(wheel, 2);
  assert(scroll.x == 0 && scroll.y == 0 && scroll.relative[0].value == 1);
}
