router.get("/export-excel", checkAuth, async (req, res) => {
  try {
    if (!req.user || req.user.email !== "mipotrerooficial@gmail.com") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const buffer = await exportFirestoreToExcel();

    res.status(200);
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=mipotrero.xlsx",
      "Content-Length": buffer.length,
    });

    return res.end(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error generando Excel" });
  }
});
