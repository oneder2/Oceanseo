package com.tideplan.mobile

import org.junit.Assert.*
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class ReminderTimeTest {
    private fun local(year: Int, month: Int, day: Int, hour: Int, minute: Int) = Calendar.getInstance(TimeZone.getTimeZone("America/New_York")).apply {
        clear(); set(year, month - 1, day, hour, minute)
    }
    @Test fun springForwardKeepsNineAmInsteadOfAddingTwentyFourHours() {
        val now = local(2026, 3, 7, 10, 0)
        val expected = local(2026, 3, 8, 9, 0)
        assertEquals(expected.timeInMillis, Reminders.nextTime("09:00", now))
        assertEquals(22 * 60 * 60 * 1000L, expected.timeInMillis - now.timeInMillis)
    }
    @Test fun fallBackKeepsLocalEveningTime() {
        assertEquals(local(2026, 11, 1, 19, 0).timeInMillis, Reminders.nextTime("19:00", local(2026, 10, 31, 20, 0)))
    }
    @Test fun sameMinuteSchedulesTomorrowAndDoesNotReplayToday() {
        assertEquals(local(2026, 9, 28, 9, 0).timeInMillis, Reminders.nextTime("09:00", local(2026, 9, 27, 9, 0)))
    }
    @Test fun futureSlotRemainsToday() {
        assertEquals(local(2026, 9, 27, 19, 0).timeInMillis, Reminders.nextTime("19:00", local(2026, 9, 27, 9, 0)))
    }
    @Test fun coldLaunchRestoresTodaysDelayedSlotWithoutReplayingYesterday() {
        val now = local(2026, 9, 28, 9, 5)
        val today = local(2026, 9, 28, 9, 0).timeInMillis
        assertEquals(today, Reminders.restoredTime("09:00", today, now))
        assertEquals(local(2026, 9, 29, 9, 0).timeInMillis,
            Reminders.restoredTime("09:00", local(2026, 9, 27, 9, 0).timeInMillis, now))
    }
    @Test fun changedTimeZoneDoesNotRestoreAnOldWallClockTime() {
        val now = local(2026, 9, 28, 10, 0)
        assertEquals(local(2026, 9, 29, 9, 0).timeInMillis,
            Reminders.restoredTime("09:00", local(2026, 9, 28, 8, 0).timeInMillis, now))
    }
}
