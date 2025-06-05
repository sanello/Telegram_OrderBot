import sys
import os
import signal
import threading
import time
import json
import subprocess
import tkinter as tk
from tkinter.scrolledtext import ScrolledText
from PIL import ImageTk, Image

try:
    import pystray
    from pystray import MenuItem as item
except ImportError:
    print("Установите pystray и pillow:")
    print("pip install pystray pillow")
    sys.exit(1)

try:
    import win32event
    import win32api
    import win32con
    import winerror
    import win32gui
except ImportError:
    print("Установите pywin32:")
    print("pip install pywin32")
    sys.exit(1)

# --- Защита от повторного запуска ---
mutex = win32event.CreateMutex(None, False, "MyUniqueMutexName_ManagerApp")
if win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS:
    hwnd = win32gui.FindWindow(None, "Менеджер процессов")
    if hwnd:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
    sys.exit(0)

AUTOSTART_FILE = "autostart.json"

def load_autostart():
    if os.path.isfile(AUTOSTART_FILE):
        with open(AUTOSTART_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_autostart(data):
    with open(AUTOSTART_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

class ScriptEntry:
    def __init__(self, parent, folder, log_callback, autostart_state, on_autostart_change, get_selected_user):
        self.folder = folder
        self.log_callback = log_callback
        self.process = None
        self.on_autostart_change = on_autostart_change
        self.get_selected_user = get_selected_user

        self.frame = tk.Frame(parent)
        self.frame.pack(fill=tk.X, padx=10, pady=2)

        self.autostart_var = tk.BooleanVar(value=autostart_state)
        self.autostart_check = tk.Checkbutton(self.frame, variable=self.autostart_var, command=self._autostart_changed)
        self.autostart_check.pack(side=tk.LEFT, padx=5)

        self.label = tk.Label(self.frame, text=folder, width=30, anchor="w")
        self.label.pack(side=tk.LEFT)

        self.status_var = tk.StringVar(value="⛔ Остановлен")
        self.status_label = tk.Label(self.frame, textvariable=self.status_var, width=15)
        self.status_label.pack(side=tk.RIGHT, padx=5)

        self.stop_button = tk.Button(self.frame, text="Остановить", command=self.stop_script, state=tk.DISABLED)
        self.stop_button.pack(side=tk.RIGHT, padx=5)

        self.start_button = tk.Button(self.frame, text="Запустить", command=self.start_script)
        self.start_button.pack(side=tk.RIGHT, padx=5)

    def _autostart_changed(self):
        self.on_autostart_change(self.folder, self.autostart_var.get())

    def start_script(self):
        if self.process and self.process.poll() is None:
            self.log_callback(f"[{self.folder}] Уже запущен.\n")
            return

        self.status_var.set("✅ Запущен")
        self.start_button.config(state=tk.DISABLED)
        self.stop_button.config(state=tk.NORMAL)

        thread = threading.Thread(target=self.run_script, daemon=True)
        thread.start()

    def run_script(self):
        try:
            user = self.get_selected_user()
            arg = "@defaultuser"
            if user == "Марина":
                arg = "@Marinashpi"
            elif user == "Алексей":
                arg = "@Leshii077"
                
            self.log_callback(f"[{self.folder}] Выбран аргумент: {arg}\n")
            
            self.process = subprocess.Popen(
                #["pythonw", "-u", "start.py"],
                ["pythonw", "-u", "start.py", arg],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1,
                cwd=self.folder,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
            )

            for line in self.process.stdout:
                self.log_callback(f"[{self.folder}] {line}")
            self.process.stdout.close()
            self.process.wait()
            self._on_process_finish()

        except Exception as e:
            self.log_callback(f"[{self.folder}] Ошибка запуска: {e}\n")
            self.status_var.set("❌ Ошибка")
            self._enable_buttons()

    def _on_process_finish(self):
        def update_ui():
            self.status_var.set("⛔ Завершён")
            self._enable_buttons()
        self.frame.after(0, update_ui)

    def _enable_buttons(self):
        self.start_button.config(state=tk.NORMAL)
        self.stop_button.config(state=tk.DISABLED)

    def stop_script(self):
        if self.process and self.process.poll() is None:
            try:
                if os.name == 'nt':
                    self.process.terminate()
                else:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                self.status_var.set("⛔ Остановлен")
                self.log_callback(f"[{self.folder}] Остановлен.\n")
            except Exception as e:
                self.log_callback(f"[{self.folder}] Ошибка при остановке: {e}\n")
        self._enable_buttons()

class ScriptRunnerApp:
    def on_user_change(self):
        user = self.selected_user.get()
        self.append_log(f"🔄 Пользователь изменён на: {user}\n")

        self.stop_all()  # вызываем остановку всех скриптов

        # запускаем автозапуск через 1 секунду (чтобы успели остановиться)
        self.root.after(1000, self.autostart_scripts)
    
    def __init__(self, root):
        self.root = root
        self.root.title("Менеджер процессов")
        self.root.geometry("765x450")
        self.root.resizable(False, True)

        self.icon_image = ImageTk.PhotoImage(file="icon.ico")
        self.root.iconphoto(False, self.icon_image)

        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        self.script_entries = []
        self.autostart_config = load_autostart()

        self.main_frame = tk.Frame(root)
        self.main_frame.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 0))
        self.main_frame.grid_columnconfigure(0, weight=0)
        self.main_frame.grid_columnconfigure(1, weight=1)

        self.left_panel = tk.LabelFrame(self.main_frame, text="Управление")
        self.left_panel.grid(row=0, column=0, sticky="n", padx=(0, 10))

        self.start_all_button = tk.Button(self.left_panel, text="🔁 Запустить все", width=20, command=self.start_all)
        self.start_all_button.pack(pady=0, padx=10)

        self.stop_all_button = tk.Button(self.left_panel, text="⛔ Остановить все", width=20, command=self.stop_all)
        self.stop_all_button.pack(pady=0, padx=10)

        # Радиокнопки "Алексей" и "Марина"
        self.selected_user = tk.StringVar(value="")  # пустое значение по умолчанию

        radio_frame = tk.Frame(self.left_panel)
        radio_frame.pack(pady=(5, 10), padx=10, anchor='w')

        self.alexey_radio = tk.Radiobutton(radio_frame, text="Алексей", variable=self.selected_user, value="Алексей", command=self.on_user_change)
        self.alexey_radio.pack(side=tk.LEFT, padx=(0, 10))

        self.marina_radio = tk.Radiobutton(radio_frame, text="Марина", variable=self.selected_user, value="Марина", command=self.on_user_change)
        self.marina_radio.pack(side=tk.LEFT)

        self.script_frame = tk.LabelFrame(self.main_frame, text="Скрипты")
        self.script_frame.grid(row=0, column=1, sticky="nw")

        self.log_frame = tk.Frame(root)
        self.log_frame.grid(row=1, column=0, sticky="nsew", padx=(0, 10), pady=(10, 10))

        self.log_frame.grid_rowconfigure(0, weight=1)
        self.log_frame.grid_columnconfigure(0, weight=1)

        self.log_area = ScrolledText(self.log_frame, wrap=tk.WORD, font=("Consolas", 10))
        self.log_area.grid(row=0, column=0, sticky="nsew")

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self.icon = None
        self.icon_thread = None

        self.load_scripts()

    def load_scripts(self):
        base_dir = os.getcwd()
        folders = [
            d for d in os.listdir(base_dir)
            if os.path.isdir(d) and os.path.isfile(os.path.join(d, "start.py"))
        ]

        if not folders:
            self.append_log("Не найдено ни одного скрипта start.py\n")
            return

        for folder in folders:
            entry = ScriptEntry(
                self.script_frame,
                folder,
                self.append_log,
                self.autostart_config.get(folder, False),
                self.update_autostart,
                get_selected_user=lambda: self.selected_user.get()  # передаем функцию
            )
            self.script_entries.append(entry)

        threading.Thread(target=self.autostart_scripts, daemon=True).start()

    def update_autostart(self, folder, value):
        self.autostart_config[folder] = value
        save_autostart(self.autostart_config)

    def autostart_scripts(self):
        for entry in self.script_entries:
            if entry.autostart_var.get():
                entry.start_script()
                time.sleep(1)

    def start_all(self):
        threading.Thread(target=self._start_all_thread, daemon=True).start()

    def stop_all(self):
        threading.Thread(target=self._stop_all_thread, daemon=True).start()

    def _start_all_thread(self):
        for entry in self.script_entries:
            entry.start_script()
            time.sleep(1)

    def _stop_all_thread(self):
        for entry in self.script_entries:
            entry.stop_script()

    def on_close(self):
        self.hide_window()

    def hide_window(self):
        self.root.withdraw()
        if self.icon is None:
            image = Image.open("icon.ico")
            menu = (
                item('Показать', self.show_window),
                item('Выход', self.exit_app)
            )
            self.icon = pystray.Icon("Менеджер процессов", image, "Менеджер процессов", menu)
            self.icon_thread = threading.Thread(target=self.icon.run, daemon=True)
            self.icon_thread.start()

    def show_window(self, icon=None, item=None):
        self.root.deiconify()
        self.root.after(0, self.root.lift)
        self.root.attributes('-topmost', True)
        self.root.after(100, lambda: self.root.attributes('-topmost', False))

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        if self.icon:
            self.icon.stop()
            self.icon = None

    def exit_app(self, icon=None, item=None):
        self._stop_all_thread()
        if self.icon:
            self.icon.stop()
            self.icon = None
        self.root.destroy()

    def append_log(self, text):
        self.log_area.insert(tk.END, text)
        self.log_area.see(tk.END)

if __name__ == "__main__":
    root = tk.Tk()
    app = ScriptRunnerApp(root)
    root.mainloop()
