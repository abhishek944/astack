#!/usr/bin/env python3
"""Astack desktop smoke window.

A deliberately tiny GTK3 window used to prove, on the VM, that the Cua Driver can read an
accessibility tree, act on an element, and that the application's own state changed. It is a
verification fixture, not a product.

Environment:
  ASTACK_TOY_RESULT  optional file that receives the applied value

Exit code 0 on normal close.
"""
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: E402

RESULT_FILE = os.environ.get("ASTACK_TOY_RESULT", "")


class SmokeWindow(Gtk.Window):
    def __init__(self):
        super().__init__(title="Astack Desktop Smoke")
        self.set_default_size(520, 220)
        self.set_border_width(18)
        self.connect("destroy", Gtk.main_quit)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        self.add(box)

        intro = Gtk.Label(label="Type a value into the field, then press Apply.")
        intro.set_xalign(0)
        box.pack_start(intro, False, False, 0)

        self.entry = Gtk.Entry()
        self.entry.set_placeholder_text("Value")
        self.entry.get_accessible().set_name("toy-input")
        self.entry.connect("changed", self.on_changed)
        self.entry.connect("activate", self.on_apply)
        box.pack_start(self.entry, False, False, 0)

        self.button = Gtk.Button(label="Apply")
        self.button.get_accessible().set_name("apply-button")
        self.button.connect("clicked", self.on_apply)
        box.pack_start(self.button, False, False, 0)

        self.status = Gtk.Label(label="Live: (empty)")
        self.status.set_xalign(0)
        self.status.get_accessible().set_name("status-label")
        box.pack_start(self.status, False, False, 0)

        self.show_all()

    def on_changed(self, entry):
        self.status.set_text("Live: " + entry.get_text())

    def on_apply(self, *_args):
        value = self.entry.get_text()
        self.status.set_text("Applied: " + value)
        if RESULT_FILE:
            with open(RESULT_FILE, "w", encoding="utf-8") as handle:
                handle.write(value + "\n")


def main():
    Gtk.init(sys.argv)
    SmokeWindow()
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
