// server.js
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Extract text from uploaded resume
async function extractText(file) {
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (ext === "pdf") {
    const data = await pdfParse(file.buffer);
    return data.text || "";
  } else if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || "";
  } else if (ext === "doc") {
    return "";
  }
  return "";
}

// Extract skills from text
function extractSkills(text) {
  const skillsList = [
    "JavaScript", "Java", "Python", "React", "Node.js",
    "Angular", "C++", "C#", "SQL", "HTML", "CSS",
    "AWS", "Docker", "Kubernetes", "MongoDB"
  ];

  const extracted = [];
  const normalizedText = text.replace(/[\.\+#]/g, "").toLowerCase();

  for (let skill of skillsList) {
    const normSkill = skill.replace(/[\.\+#]/g, "").toLowerCase();
    if (normalizedText.includes(normSkill)) {
      extracted.push(skill);
    }
  }

  return extracted;
}

// Dummy jobs to show if live jobs fail
const dummyJobs = [
  { title: "Frontend Developer", company: "TechCorp", location: "Remote", url: "#" },
  { title: "Backend Developer", company: "CodeBase", location: "Mumbai", url: "#" },
  { title: "Fullstack Engineer", company: "InnovateX", location: "Bangalore", url: "#" }
];

// Upload and process resume
app.post("/upload-cv", upload.single("cv"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const text = await extractText(req.file);
    console.log("Extracted Resume Text (first 500 chars):", text.substring(0, 500));

    const skills = extractSkills(text);
    console.log("Extracted Skills:", skills);

    let jobs = [];
    let apiLimitExceeded = false;

    try {
      const response = await axios.post(
        "https://api.theirstack.com/v1/jobs/search",
        {
          page: 0,
          limit: 25,
          job_country_code_or: ["IN"],
          posted_at_max_age_days: 30
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.TS__API_KEY}`
          }
        }
      );

      if (response.data && response.data.data && response.data.data.length > 0) {
        // Filter jobs based on extracted skills
        jobs = response.data.data
          .filter(job => {
            const textToCheck = (job.job_title + " " + (job.description || "")).toLowerCase();
            return skills.some(skill => textToCheck.includes(skill.toLowerCase()));
          })
          .map(job => ({
            title: job.job_title || "No title",
            company: job.company || "Unknown",
            location: job.locations && job.locations.length > 0
              ? job.locations[0].city + ", " + job.locations[0].country_code
              : "Remote",
            url: job.final_url || job.source_url || "#"
          }));

        if (jobs.length === 0) apiLimitExceeded = true;

      } else {
        apiLimitExceeded = true;
      }

    } catch (err) {
      console.error("TheirStack API error:", err.response ? err.response.data : err.message);
      apiLimitExceeded = true;
    }

    // If API limit exceeded, show message + dummy jobs
    if (apiLimitExceeded) {
      return res.json({
        message: "TheirStack web scraping limit exceeded. Showing dummy jobs below.",
        extractedSkills: skills,
        jobs: dummyJobs
      });
    }

    // Otherwise, return live jobs
    res.json({ extractedSkills: skills, jobs });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error." });
  }
});

// Listen on Render-assigned PORT or local 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.RENDER) {
    console.log(`Deployed URL: https://${process.env.RENDER_SERVICE_NAME}.onrender.com`);
  } else {
    console.log(`Local: http://localhost:${PORT}`);
  }
});
