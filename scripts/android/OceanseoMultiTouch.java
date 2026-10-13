import android.hardware.input.InputManager;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.MotionEvent;
import java.lang.reflect.Method;

/** Shell-only emulator QA helper. Sends real Android multi-pointer input,
 * without browser event dispatch or restarting the app under instrumentation. */
public final class OceanseoMultiTouch {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) throw new IllegalArgumentException("x y startSeparation endSeparation translationX");
        Method property = Class.forName("android.os.SystemProperties").getMethod("get", String.class);
        if (!"1".equals(property.invoke(null, "ro.kernel.qemu"))) throw new SecurityException("Emulator only");
        float x = Float.parseFloat(args[0]), y = Float.parseFloat(args[1]);
        float start = Float.parseFloat(args[2]), end = Float.parseFloat(args[3]), shift = Float.parseFloat(args[4]);
        // New Android releases moved the shell injection singleton to
        // InputManagerGlobal. Keep the older API fallback for older emulators.
        Class<?> managerClass;
        try { managerClass = Class.forName("android.hardware.input.InputManagerGlobal"); }
        catch (ClassNotFoundException oldAndroid) { managerClass = InputManager.class; }
        Object manager = managerClass.getDeclaredMethod("getInstance").invoke(null);
        Method inject = managerClass.getMethod("injectInputEvent", InputEvent.class, int.class);
        long down = SystemClock.uptimeMillis();
        send(manager, inject, down, MotionEvent.ACTION_DOWN, x, y, start, 1);
        send(manager, inject, down, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), x, y, start, 2);
        for (int i = 1; i <= 15; i++) {
            SystemClock.sleep(20);
            float ratio = i / 15f;
            send(manager, inject, down, MotionEvent.ACTION_MOVE, x + shift * ratio, y, start + (end - start) * ratio, 2);
        }
        send(manager, inject, down, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), x + shift, y, end, 2);
        send(manager, inject, down, MotionEvent.ACTION_UP, x + shift, y, end, 1);
        System.out.println("ANDROID_MULTI_POINTER_INPUT_OK");
    }
    private static void send(Object manager, Method inject, long down, int action, float x, float y, float separation, int count) throws Exception {
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[count];
        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[count];
        for (int i = 0; i < count; i++) {
            properties[i] = new MotionEvent.PointerProperties();
            properties[i].id = i; properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coords[i] = new MotionEvent.PointerCoords();
            coords[i].x = x + (i == 0 ? -separation / 2 : separation / 2);
            coords[i].y = y; coords[i].pressure = 1; coords[i].size = 1;
        }
        MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, count, properties, coords,
            0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        try { if (!Boolean.TRUE.equals(inject.invoke(manager, event, 2))) throw new IllegalStateException("Input injection refused"); }
        finally { event.recycle(); }
    }
}
