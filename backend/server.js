const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Database setup
const db = new sqlite3.Database('residence.db');

// Create tables
db.serialize(() => {
  // Students table - with gender and emergency_contact
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_number TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      room_number TEXT NOT NULL,
      gender TEXT,
      emergency_contact TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Maintenance table
  db.run(`
    CREATE TABLE IF NOT EXISTS maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      room_number TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )
  `);

  // Events table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      date DATETIME NOT NULL,
      location TEXT
    )
  `);

  // RSVPs table
  db.run(`
    CREATE TABLE IF NOT EXISTS rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      UNIQUE(student_id, event_id)
    )
  `);

  // Emergencies table
  db.run(`
    CREATE TABLE IF NOT EXISTS emergencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      room_number TEXT NOT NULL,
      emergency_type TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      report_text TEXT,
      actions_taken TEXT,
      external_services_contacted TEXT,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )
  `);

  // Add sample events if none exist
  db.get('SELECT COUNT(*) as count FROM events', (err, row) => {
    if (!err && row.count === 0) {
      db.run(`
        INSERT INTO events (title, description, date, location) VALUES 
        ('Welcome BBQ', 'Meet and greet with all residents', '2026-07-15 18:00:00', 'Main Courtyard'),
        ('Tutorial Session: Math', 'Math help session for first years', '2026-07-20 14:00:00', 'Study Hall A'),
        ('Movie Night', 'Watch the latest blockbuster', '2026-07-25 19:00:00', 'Common Room')
      `);
      console.log('✅ Sample events added');
    }
  });

  console.log('✅ Database tables created');
});

// ---------- AUTH ROUTES ----------

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === 'admin' && password === 'admin123') {
    res.json({ 
      success: true, 
      token: 'admin-token-123', 
      role: 'admin' 
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid admin credentials' 
    });
  }
});

// Student login
app.post('/api/student/login', (req, res) => {
  const { student_number, password } = req.body;
  
  db.get(
    'SELECT * FROM students WHERE student_number = ? AND is_active = 1',
    [student_number],
    (err, student) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      if (!student) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid student number' 
        });
      }
      
      if (password !== student.password) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid password' 
        });
      }
      
      res.json({
        success: true,
        token: 'student-token-123',
        role: 'student',
        student: {
          id: student.id,
          student_number: student.student_number,
          full_name: student.full_name,
          room_number: student.room_number,
          gender: student.gender,
          emergency_contact: student.emergency_contact
        }
      });
    }
  );
});

// ---------- STUDENT ROUTES ----------

// Get student dashboard
app.get('/api/student/dashboard/:id', (req, res) => {
  const studentId = req.params.id;
  
  db.get(
    'SELECT id, student_number, full_name, room_number, gender, emergency_contact FROM students WHERE id = ? AND is_active = 1',
    [studentId],
    (err, student) => {
      if (err || !student) {
        return res.status(404).json({ 
          success: false, 
          message: 'Student not found' 
        });
      }
      res.json({ success: true, student });
    }
  );
});

// Report maintenance
app.post('/api/maintenance', (req, res) => {
  const { student_id, room_number, category, description } = req.body;
  
  db.run(
    'INSERT INTO maintenance (student_id, room_number, category, description) VALUES (?, ?, ?, ?)',
    [student_id, room_number, category, description],
    function(err) {
      if (err) {
        console.error('Maintenance insert error:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to report issue' 
        });
      }
      res.json({ 
        success: true, 
        id: this.lastID, 
        message: 'Maintenance reported successfully' 
      });
    }
  );
});

// Get student's maintenance reports
app.get('/api/maintenance/student/:studentId', (req, res) => {
  const studentId = req.params.studentId;
  
  db.all(
    'SELECT * FROM maintenance WHERE student_id = ? ORDER BY created_at DESC',
    [studentId],
    (err, reports) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, reports });
    }
  );
});

// Get all maintenance (admin)
app.get('/api/maintenance/all', (req, res) => {
  db.all(
    'SELECT m.*, s.full_name, s.student_number FROM maintenance m JOIN students s ON m.student_id = s.id ORDER BY m.created_at DESC',
    [],
    (err, reports) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, reports });
    }
  );
});

// Update maintenance status (admin)
app.put('/api/maintenance/:id', (req, res) => {
  const { status } = req.body;
  const id = req.params.id;
  
  db.run(
    'UPDATE maintenance SET status = ? WHERE id = ?',
    [status, id],
    function(err) {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to update' 
        });
      }
      res.json({ success: true, message: 'Status updated' });
    }
  );
});

// ---------- EVENTS ROUTES ----------

// Get all events
app.get('/api/events', (req, res) => {
  db.all('SELECT * FROM events ORDER BY date ASC', [], (err, events) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }
    res.json({ success: true, events });
  });
});

// ---------- RSVP ROUTES ----------

// RSVP to event (toggle)
app.post('/api/rsvp', (req, res) => {
  const { student_id, event_id } = req.body;
  
  // Check if already RSVPed
  db.get(
    'SELECT * FROM rsvps WHERE student_id = ? AND event_id = ?',
    [student_id, event_id],
    (err, existing) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      
      if (existing) {
        // If already RSVPed, remove it (toggle off)
        db.run(
          'DELETE FROM rsvps WHERE student_id = ? AND event_id = ?',
          [student_id, event_id],
          function(err) {
            if (err) {
              return res.status(500).json({ 
                success: false, 
                message: 'Failed to remove RSVP' 
              });
            }
            res.json({ 
              success: true, 
              message: 'RSVP removed',
              action: 'removed'
            });
          }
        );
      } else {
        // Add RSVP
        db.run(
          'INSERT INTO rsvps (student_id, event_id) VALUES (?, ?)',
          [student_id, event_id],
          function(err) {
            if (err) {
              return res.status(500).json({ 
                success: false, 
                message: 'Failed to RSVP' 
              });
            }
            res.json({ 
              success: true, 
              message: 'RSVP successful',
              action: 'added'
            });
          }
        );
      }
    }
  );
});

// Get RSVPs for an event
app.get('/api/rsvp/event/:eventId', (req, res) => {
  const eventId = req.params.eventId;
  
  db.all(
    `SELECT r.*, s.full_name, s.student_number, s.room_number 
     FROM rsvps r 
     JOIN students s ON r.student_id = s.id 
     WHERE r.event_id = ?`,
    [eventId],
    (err, rsvps) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, rsvps });
    }
  );
});

// Get all RSVPs with student and event details (for admin)
app.get('/api/rsvp/all', (req, res) => {
  db.all(
    `SELECT 
      r.id,
      r.created_at as rsvp_date,
      s.id as student_id,
      s.full_name,
      s.student_number,
      s.room_number,
      e.id as event_id,
      e.title as event_title,
      e.date as event_date
     FROM rsvps r 
     JOIN students s ON r.student_id = s.id 
     JOIN events e ON r.event_id = e.id 
     ORDER BY r.created_at DESC`,
    [],
    (err, rsvps) => {
      if (err) {
        console.error('Error fetching RSVPs:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, rsvps });
    }
  );
});

// Check if student has RSVPed to an event
app.get('/api/rsvp/check/:studentId/:eventId', (req, res) => {
  const { studentId, eventId } = req.params;
  
  db.get(
    'SELECT * FROM rsvps WHERE student_id = ? AND event_id = ?',
    [studentId, eventId],
    (err, rsvp) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, rsvped: !!rsvp });
    }
  );
});

// ---------- ADMIN ROUTES ----------

// Add student
app.post('/api/admin/students', (req, res) => {
  const { student_number, password, full_name, room_number, gender, emergency_contact } = req.body;
  
  db.run(
    'INSERT INTO students (student_number, password, full_name, room_number, gender, emergency_contact) VALUES (?, ?, ?, ?, ?, ?)',
    [student_number, password, full_name, room_number, gender || 'Other', emergency_contact || ''],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ 
            success: false, 
            message: 'Student number already exists' 
          });
        }
        console.error('Add student error:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to add student' 
        });
      }
      res.json({ 
        success: true, 
        id: this.lastID, 
        message: 'Student added successfully' 
      });
    }
  );
});

// Get all students (admin)
app.get('/api/admin/students', (req, res) => {
  db.all(
    'SELECT id, student_number, full_name, room_number, gender, emergency_contact, is_active, created_at FROM students ORDER BY created_at DESC',
    [],
    (err, students) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, students });
    }
  );
});

// Delete student (end of year)
app.delete('/api/admin/students/:id', (req, res) => {
  const id = req.params.id;
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM rsvps WHERE student_id = ?', [id]);
    db.run('DELETE FROM maintenance WHERE student_id = ?', [id]);
    db.run('DELETE FROM emergencies WHERE student_id = ?', [id]);
    db.run('DELETE FROM students WHERE id = ?', [id], function(err) {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to delete student' 
        });
      }
      db.run('COMMIT');
      res.json({ success: true, message: 'Student deleted successfully' });
    });
  });
});

// Add event (admin)
app.post('/api/admin/events', (req, res) => {
  const { title, description, date, location } = req.body;
  
  db.run(
    'INSERT INTO events (title, description, date, location) VALUES (?, ?, ?, ?)',
    [title, description, date, location],
    function(err) {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to add event' 
        });
      }
      res.json({ 
        success: true, 
        id: this.lastID, 
        message: 'Event added successfully' 
      });
    }
  );
});

// ============================================================
// ===== EMERGENCY ROUTES =====
// ============================================================

// Report emergency (student)
app.post('/api/emergency/report', (req, res) => {
  const { student_id, student_name, room_number, emergency_type, description } = req.body;
  
  db.run(
    `INSERT INTO emergencies (
      student_id, 
      student_name, 
      room_number, 
      emergency_type, 
      description, 
      status
    ) VALUES (?, ?, ?, ?, ?, 'active')`,
    [student_id, student_name, room_number, emergency_type, description],
    function(err) {
      if (err) {
        console.error('Emergency report error:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to report emergency' 
        });
      }
      
      res.json({ 
        success: true, 
        id: this.lastID,
        message: '🚨 Emergency reported! Admin has been notified.' 
      });
    }
  );
});

// Get all emergencies (admin)
app.get('/api/emergency/all', (req, res) => {
  db.all(
    `SELECT 
      e.*,
      s.full_name as student_full_name,
      s.student_number,
      s.room_number as student_room
     FROM emergencies e
     LEFT JOIN students s ON e.student_id = s.id
     ORDER BY e.reported_at DESC`,
    [],
    (err, emergencies) => {
      if (err) {
        console.error('Error fetching emergencies:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, emergencies });
    }
  );
});

// Get active emergencies (admin)
app.get('/api/emergency/active', (req, res) => {
  db.all(
    `SELECT 
      e.*,
      s.full_name as student_full_name,
      s.student_number,
      s.room_number as student_room,
      s.emergency_contact
     FROM emergencies e
     LEFT JOIN students s ON e.student_id = s.id
     WHERE e.status = 'active'
     ORDER BY e.reported_at DESC`,
    [],
    (err, emergencies) => {
      if (err) {
        console.error('Error fetching active emergencies:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, emergencies });
    }
  );
});

// Get emergency by ID (for report generation)
app.get('/api/emergency/:id', (req, res) => {
  const id = req.params.id;
  
  db.get(
    `SELECT 
      e.*,
      s.full_name as student_full_name,
      s.student_number,
      s.room_number as student_room,
      s.emergency_contact
     FROM emergencies e
     LEFT JOIN students s ON e.student_id = s.id
     WHERE e.id = ?`,
    [id],
    (err, emergency) => {
      if (err || !emergency) {
        return res.status(404).json({ 
          success: false, 
          message: 'Emergency not found' 
        });
      }
      res.json({ success: true, emergency });
    }
  );
});

// Update emergency status (admin)
app.put('/api/emergency/:id/status', (req, res) => {
  const { status } = req.body;
  const id = req.params.id;
  
  const resolvedAt = status === 'resolved' ? 'CURRENT_TIMESTAMP' : 'NULL';
  const query = status === 'resolved' 
    ? `UPDATE emergencies SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
    : `UPDATE emergencies SET status = ? WHERE id = ?`;
  
  db.run(query, [status, id], function(err) {
    if (err) {
      console.error('Update emergency error:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update emergency' 
      });
    }
    res.json({ 
      success: true, 
      message: `Emergency ${status === 'resolved' ? 'resolved' : 'updated'} successfully` 
    });
  });
});

// Write emergency report (admin)
app.post('/api/emergency/:id/report', (req, res) => {
  const { report_text, actions_taken, external_services_contacted } = req.body;
  const id = req.params.id;
  
  db.run(
    `UPDATE emergencies 
     SET report_text = ?,
         actions_taken = ?,
         external_services_contacted = ?,
         status = 'resolved',
         resolved_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [report_text, actions_taken, external_services_contacted || 'None', id],
    function(err) {
      if (err) {
        console.error('Report save error:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to save report' 
        });
      }
      res.json({ 
        success: true, 
        message: 'Report saved successfully' 
      });
    }
  );
});

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Open your browser and go to: http://localhost:${PORT}`);
  console.log(`🔑 Admin login: admin / admin123`);
});
// ===== STUDENT EMERGENCY HISTORY =====

// Get student's own emergency reports
app.get('/api/emergency/student/:studentId', (req, res) => {
  const studentId = req.params.studentId;
  
  db.all(
    `SELECT 
      id,
      student_name,
      room_number,
      emergency_type,
      description,
      status,
      reported_at,
      resolved_at,
      report_text,
      actions_taken,
      external_services_contacted
     FROM emergencies 
     WHERE student_id = ?
     ORDER BY reported_at DESC`,
    [studentId],
    (err, emergencies) => {
      if (err) {
        console.error('Error fetching student emergencies:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Database error' 
        });
      }
      res.json({ success: true, emergencies });
    }
  );
});

// Get a single emergency report for student
app.get('/api/emergency/student/:studentId/:emergencyId', (req, res) => {
  const { studentId, emergencyId } = req.params;
  
  db.get(
    `SELECT 
      id,
      student_name,
      room_number,
      emergency_type,
      description,
      status,
      reported_at,
      resolved_at,
      report_text,
      actions_taken,
      external_services_contacted
     FROM emergencies 
     WHERE student_id = ? AND id = ?`,
    [studentId, emergencyId],
    (err, emergency) => {
      if (err || !emergency) {
        return res.status(404).json({ 
          success: false, 
          message: 'Emergency report not found' 
        });
      }
      res.json({ success: true, emergency });
    }
  );
});