export const imagingEn = {
  imaging: {
    title: "Imaging",
    nav: {
      reports: "Imaging reports",
    },
    worklist: {
      title: "Imaging reports",
      subtitle:
        "Paid studies at {branch}: mark the study done, upload the radiologist's signed PDF, then release it.",
      listTitle: "Studies",
      empty: "No paid imaging studies.",
      study: "Study",
      indication: "Indication",
      markDone: "Mark done",
      upload: "Upload signed report PDF",
      release: "Release",
      doneToast: "{study} marked done",
      uploadedToast: "Signed report uploaded for {orderNo}",
      releasedToast: "Imaging report released for {orderNo}",
      releasedAt: "Released {time}",
      hash: "SHA-256 {hash}",
    },
    status: {
      ordered: "Not paid",
      paid: "Waiting",
      done: "Done, report due",
      reported: "Report uploaded",
      released: "Released",
      cancelled: "Cancelled",
    },
    modalities: {
      xray: "X-ray",
      usg: "Ultrasound",
      ct: "CT",
      mri: "MRI",
      ecg: "ECG",
      echo: "Echo",
    },
    upload: {
      title: "Upload signed report PDF",
      file: "File",
      choose: "Choose file",
      fileHint:
        "Simulated: no file leaves this browser. We keep its name and SHA-256 hash.",
      radiologist: "Reporting doctor",
      summary: "Impression (optional)",
      summaryPlaceholder:
        "One line for the doctor, for example: fatty liver, grade I",
      confirm: "Upload",
    },
    events: {
      ImagingStudyCompleted: "Imaging study {study} done ({orderNo})",
      ImagingReportUploaded: "Imaging report uploaded ({orderNo})",
      ImagingReportReleased: "Imaging report released ({orderNo})",
    },
    consumers: {
      radiologist: "Radiologist",
    },
  },
}
