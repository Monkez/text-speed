use crate::rdev::{Event, ListenError};
use crate::windows::common::{convert, set_key_hook, set_mouse_hook, HookError, HOOK};
use std::os::raw::c_int;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;
use winapi::shared::minwindef::{LPARAM, LRESULT, WPARAM};
use winapi::um::winuser::{CallNextHookEx, GetMessageA, HC_ACTION};

static mut GLOBAL_CALLBACK: Option<Box<dyn FnMut(Event)>> = None;
static LISTEN_PAUSED: AtomicBool = AtomicBool::new(false);

impl From<HookError> for ListenError {
    fn from(error: HookError) -> Self {
        match error {
            HookError::Mouse(code) => ListenError::MouseHookError(code),
            HookError::Key(code) => ListenError::KeyHookError(code),
        }
    }
}

unsafe extern "system" fn raw_callback(code: c_int, param: WPARAM, lpdata: LPARAM) -> LRESULT {
    if LISTEN_PAUSED.load(Ordering::SeqCst) {
        return CallNextHookEx(HOOK, code, param, lpdata);
    }

    if code == HC_ACTION {
        let opt = convert(param, lpdata);
        if let Some(event_type) = opt {
            let name = None;
            let event = Event {
                event_type,
                time: SystemTime::now(),
                name,
            };
            if let Some(callback) = &mut GLOBAL_CALLBACK {
                callback(event);
            }
        }
    }
    CallNextHookEx(HOOK, code, param, lpdata)
}

pub fn listen<T>(callback: T) -> Result<(), ListenError>
where
    T: FnMut(Event) + 'static,
{
    unsafe {
        GLOBAL_CALLBACK = Some(Box::new(callback));
        set_key_hook(raw_callback)?;
        set_mouse_hook(raw_callback)?;

        GetMessageA(null_mut(), null_mut(), 0, 0);
    }
    Ok(())
}

pub fn set_listen_paused(paused: bool) {
    LISTEN_PAUSED.store(paused, Ordering::SeqCst);
}
