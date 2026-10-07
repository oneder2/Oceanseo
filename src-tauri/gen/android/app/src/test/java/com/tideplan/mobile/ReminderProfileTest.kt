package com.tideplan.mobile

import org.junit.Assert.*
import org.junit.Test

class ReminderProfileTest {
    @Test fun deliveryLedgersAreIndependentAndLocalLedgerIsCompatible() {
        val alice = "a".repeat(64)
        val bob = "b".repeat(64)
        assertEquals("last-0", Reminders.receiptKey("local", 0))
        assertEquals("last-1", Reminders.receiptKey("local", 1))
        assertNotEquals(Reminders.receiptKey(alice, 0), Reminders.receiptKey(bob, 0))
        assertNotEquals(Reminders.receiptKey(alice, 0), Reminders.receiptKey(alice, 1))
        assertNotEquals(Reminders.receiptKey("local", 0), Reminders.receiptKey(alice, 0))
    }

    @Test fun invalidOwnerOrSlotCannotSelectAnotherLedger() {
        for (key in listOf("", "../local", "a".repeat(63), "A".repeat(64), "local:1")) {
            assertFalse(Reminders.validProfile(key))
            assertThrows(IllegalArgumentException::class.java) { Reminders.receiptKey(key, 0) }
        }
        assertThrows(IllegalArgumentException::class.java) { Reminders.receiptKey("local", -1) }
        assertThrows(IllegalArgumentException::class.java) { Reminders.receiptKey("local", 2) }
    }
}
