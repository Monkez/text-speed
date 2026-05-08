#[cfg(target_os = "windows")]
mod windows_editor {
    use std::{ffi::OsStr, iter::once, mem, os::windows::ffi::OsStrExt, ptr::null_mut, thread};

    use winapi::{
        shared::{
            minwindef::{LPARAM, LRESULT, UINT, WPARAM},
            windef::{HBRUSH, HWND},
        },
        um::{
            libloaderapi::GetModuleHandleW,
            winuser::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
                GetSystemMetrics, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW,
                LoadCursorW, PostQuitMessage, RegisterClassW, SendMessageW, SetFocus,
                SetWindowLongPtrW, SetWindowTextW, ShowWindow, TranslateMessage, BS_DEFPUSHBUTTON,
                BS_PUSHBUTTON, COLOR_WINDOW, CW_USEDEFAULT, ES_AUTOHSCROLL, ES_AUTOVSCROLL,
                ES_LEFT, ES_MULTILINE, ES_WANTRETURN, GWLP_USERDATA, IDC_ARROW, MSG, SM_CXSCREEN,
                SM_CYSCREEN, SW_SHOW, WM_CLOSE, WM_COMMAND, WM_DESTROY, WM_SETFONT, WNDCLASSW,
                WS_BORDER, WS_CAPTION, WS_CHILD, WS_EX_CLIENTEDGE, WS_OVERLAPPED, WS_SYSMENU,
                WS_TABSTOP, WS_VISIBLE,
            },
        },
    };

    const ID_EDIT: usize = 1001;
    const ID_OK: usize = 1002;
    const ID_CANCEL: usize = 1003;

    struct DialogState {
        edit: HWND,
        result: Option<String>,
    }

    pub fn edit_text(
        title: String,
        value: String,
        multiline: bool,
    ) -> Result<Option<String>, String> {
        thread::spawn(move || unsafe { run_dialog(&title, &value, multiline) })
            .join()
            .map_err(|_| "Native editor thread panicked".to_string())?
    }

    unsafe fn run_dialog(
        title: &str,
        value: &str,
        multiline: bool,
    ) -> Result<Option<String>, String> {
        let instance = GetModuleHandleW(null_mut());
        let class_name = wide("TextSpeedNativeEditor");
        let wnd = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: null_mut(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: (COLOR_WINDOW + 1) as HBRUSH,
            lpszMenuName: null_mut(),
            lpszClassName: class_name.as_ptr(),
        };
        RegisterClassW(&wnd);

        let width = if multiline { 660 } else { 560 };
        let height = if multiline { 430 } else { 170 };
        let x = (GetSystemMetrics(SM_CXSCREEN) - width) / 2;
        let y = (GetSystemMetrics(SM_CYSCREEN) - height) / 2;
        let title_w = wide(title);
        let state = Box::into_raw(Box::new(DialogState {
            edit: null_mut(),
            result: None,
        }));

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            title_w.as_ptr(),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
            if x > 0 { x } else { CW_USEDEFAULT },
            if y > 0 { y } else { CW_USEDEFAULT },
            width,
            height,
            null_mut(),
            null_mut(),
            instance,
            null_mut(),
        );
        if hwnd.is_null() {
            drop(Box::from_raw(state));
            return Err("Cannot create native editor window".to_string());
        }
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);

        let edit_style = WS_CHILD
            | WS_VISIBLE
            | WS_TABSTOP
            | WS_BORDER
            | ES_LEFT
            | if multiline {
                ES_MULTILINE | ES_AUTOVSCROLL | ES_WANTRETURN
            } else {
                ES_AUTOHSCROLL
            };
        let edit = CreateWindowExW(
            WS_EX_CLIENTEDGE,
            wide("EDIT").as_ptr(),
            wide("").as_ptr(),
            edit_style,
            18,
            18,
            width - 52,
            if multiline { height - 112 } else { 28 },
            hwnd,
            ID_EDIT as _,
            instance,
            null_mut(),
        );
        if edit.is_null() {
            DestroyWindow(hwnd);
            drop(Box::from_raw(state));
            return Err("Cannot create native edit control".to_string());
        }
        (*state).edit = edit;
        SetWindowTextW(edit, wide(value).as_ptr());

        let button_y = if multiline { height - 78 } else { 78 };
        CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("OK").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
            width - 220,
            button_y,
            90,
            32,
            hwnd,
            ID_OK as _,
            instance,
            null_mut(),
        );
        CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("Cancel").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
            width - 120,
            button_y,
            90,
            32,
            hwnd,
            ID_CANCEL as _,
            instance,
            null_mut(),
        );

        let font = SendMessageW(hwnd, 0x0031, 0, 0);
        SendMessageW(edit, WM_SETFONT, font as WPARAM, 1);
        ShowWindow(hwnd, SW_SHOW);
        SetFocus(edit);

        let mut msg: MSG = mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let result = (*state).result.take();
        drop(Box::from_raw(state));
        Ok(result)
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: UINT,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_COMMAND => {
                let id = wparam & 0xffff;
                if id == ID_OK {
                    let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut DialogState;
                    if !state.is_null() && !(*state).edit.is_null() {
                        (*state).result = Some(read_window_text((*state).edit));
                    }
                    DestroyWindow(hwnd);
                    return 0;
                }
                if id == ID_CANCEL {
                    DestroyWindow(hwnd);
                    return 0;
                }
            }
            WM_CLOSE => {
                DestroyWindow(hwnd);
                return 0;
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe fn read_window_text(hwnd: HWND) -> String {
        let len = GetWindowTextLengthW(hwnd);
        let mut buffer = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(once(0)).collect()
    }
}

#[cfg(target_os = "windows")]
pub fn edit_text(title: String, value: String, multiline: bool) -> Result<Option<String>, String> {
    windows_editor::edit_text(title, value, multiline)
}

#[cfg(not(target_os = "windows"))]
pub fn edit_text(
    _title: String,
    _value: String,
    _multiline: bool,
) -> Result<Option<String>, String> {
    Err("Native editor is only available on Windows".to_string())
}
