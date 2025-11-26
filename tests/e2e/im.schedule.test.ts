import { expect, test } from "vitest";

import {
  findCurrentScheduleItem,
  getNextScheduleItem,
  getTodayLiveStream,
  isBroadcasterBusy,
} from "../../src/handlers/im/schedule.ts";
import {
  clearBusyOverride,
  forceBusyMode,
  getBusyOverride,
} from "../../src/handlers/im/state.ts";

// Helper to create a local timestamp on a fixed calendar day.
const ts = (hour: number, minute: number) =>
  new Date(2023, 0, 2, hour, minute, 0, 0).getTime();

test("detects busy slot during recording window", () => {
  const timestamp = ts(10, 45); // inside 10:30–12:30 recording window
  const item = findCurrentScheduleItem(timestamp);
  expect(item?.name).toBe("录制舞蹈教程");
  expect(item?.busyReason).toBe("recording");

  const status = isBroadcasterBusy(timestamp);
  expect(status.isBusy).toBe(true);
  expect(status.reason).toBe("recording");
  expect(typeof status.until).toBe("number");
  expect((status.until ?? 0) > timestamp).toBe(true);
});

test("handles cross-midnight busy slot for sleeping", () => {
  const timestamp = ts(23, 30); // overlaps 23:00–08:00 sleeping window
  const status = isBroadcasterBusy(timestamp);
  expect(status.isBusy).toBe(true);
  expect(status.reason).toBe("sleeping");

  // until should land on next day 08:00
  const until = status.until ?? 0;
  const untilDate = new Date(until);
  expect(untilDate.getHours()).toBe(8);
  expect(untilDate.getMinutes()).toBe(0);
});

test("lists next schedule item and live stream window", () => {
  const timestamp = ts(17, 30); // before evening stream
  const next = getNextScheduleItem(timestamp);
  expect(next?.item.name).toBe("晚间直播");

  const live = getTodayLiveStream(timestamp);
  expect(live.hasLiveToday).toBe(true);
  expect(live.startTime).toBe("18:00");
  expect(live.endTime).toBe("21:00");
});

test("forced busy override supersedes schedule", () => {
  try {
    forceBusyMode("maintenance");
    const override = getBusyOverride();
    expect(override.mode).toBe("forced_busy");

    const timestamp = ts(9, 0); // normally non-busy slot
    const status = isBroadcasterBusy(timestamp);
    expect(status.isBusy).toBe(true);
    expect(status.reason).toBe("maintenance");
  } finally {
    clearBusyOverride();
  }
});
