const express = require('express');
const { format } = require('date-fns');
const sqlite3 = require('sqlite3').verbose(); // Импортируем sqlite3
const app = express();
const port = 3000;

function getWeekOfYearMonth(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Добавляем ведущий ноль при необходимости
    const weekNumber = getWeekOfMonth(date).toString().padStart(2, '0'); // Добавляем ведущий ноль при необходимости

    return `${year}_${month}_${weekNumber}`;
}

async function getValuesFromTable(tableName) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT value FROM ${tableName}`;

        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(`Ошибка при получении данных из ${tableName}:`, err.message);
                reject(err); // Отклоняем промис с ошибкой
                return;
            }

            // Преобразуем массив строк в массив объектов
            const values = rows.map(row => JSON.parse(row.value));
            resolve(values); // Разрешаем промис с результатом
        });
    });
}


function getWeekOfMonth(date) {
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const firstDayWeek = firstDayOfMonth.getDay();
    const currentDay = date.getDate();

    const adjustedFirstDayWeek = firstDayWeek === 0 ? 7 : firstDayWeek;

    return Math.ceil((currentDay + adjustedFirstDayWeek - 2) / 7);
}
// Подключение к базе данных (или создание, если ее нет)
// Подключение к базе данных
const db = new sqlite3.Database('./leaderboard.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Подключение к базе данных установлено.');
    }
});

let state = {};

app.use(express.json());

function getValue(table){
    const sqlSelect = `SELECT value FROM ${table}`;
    db.get(sqlSelect, [], (err, row) => {
        if (err) {
            console.error(`Ошибка при получении данных из ${table}:`, err.message);
            return;
        }
        return row;
    });
}

// Функция для обновления рекорда в базе данных
function updateRecord(table, playerData) {
    const sqlSelect = `SELECT value FROM ${table} WHERE id = ?`;
    const sqlInsert = `INSERT INTO ${table}(id, value) VALUES(?, ?)`;
    const sqlUpdate = `UPDATE ${table} SET value = ? WHERE id = ?`;

    db.get(sqlSelect, [playerData.id], (err, row) => {
        if (err) {
            console.error(`Ошибка при получении данных из ${table}:`, err.message);
            return;
        }

        let existingData = row ? JSON.parse(row.value) : null;

        if (existingData && existingData.score < playerData.score) {
            // Обновляем рекорд, только если новый счет больше
            db.run(sqlUpdate, [JSON.stringify(playerData), playerData.id], (err) => {
                if (err) {
                    console.error(`Ошибка при обновлении ${table}:`, err.message);
                } else {
                    console.log(`Рекорд в ${table} обновлен для игрока ${playerData.id}`);
                }
            });
        } else if (!existingData) {
            // Вставляем новый рекорд, если его еще нет
            db.run(sqlInsert, [playerData.id, JSON.stringify(playerData)], (err) => {
                if (err) {
                    console.error(`Ошибка при вставке в ${table}:`, err.message);
                } else {
                    console.log(`Новый рекорд в ${table} добавлен для игрока ${playerData.id}`);
                }
            });
        }
    });
}

// Обработка маршрута /take (POST)
app.post('/take', (req, res) => {
    state = req.body;
    const now = new Date();
    const curday = format(now, 'yyyy_MM_dd');
    const curWeek = `week_${getWeekOfYearMonth(now)}`; // week_2024_01_04
    const curMonth = `month_${format(now, 'yyyy_MM')}`; // month_2024_01

    // Создание таблиц, если их нет
    const tableNames = [`day_${curday}`, curWeek, curMonth];
    tableNames.forEach(tableName => {
        db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (
            id TEXT PRIMARY KEY, 
            value BLOB 
        )`, (err) => {
            if (err) {
                console.error(`Ошибка при создании таблицы ${tableName}:`, err.message);
            }
        });
    });

    // Обновление данных для каждого игрока
    state.players.forEach(player => {
        if (player.id) {
            let playerData = {
                "name": player.name,
                "id": player.id,
                "score": player.score,
                "time": format(new Date(), 'dd:MM:yyyy HH:mm:ss')
            };

            updateRecord(`day_${curday}`, playerData);
            updateRecord(curWeek, playerData);
            updateRecord(curMonth, playerData);
        }
    });

    res.json({ message: 'Данные сохранены' });
});

app.get('/leaderboard', async (req, res) => {
    const now = new Date();
    const curDay = format(now, 'yyyy_MM_dd');
    const curWeek = `week_${getWeekOfYearMonth(now)}`;
    const curMonth = `month_${format(now, 'yyyy_MM')}`;

    try {
        const dayData = await getValuesFromTable(`day_${curDay}`);
        const weekData = await getValuesFromTable(curWeek);
        const monthData = await getValuesFromTable(curMonth);

        // Сортировка данных по score
        dayData.sort((a, b) => b.score - a.score);
        weekData.sort((a, b) => b.score - a.score);
        monthData.sort((a, b) => b.score - a.score);

        res.json({
            "day": dayData,
            "week": weekData,
            "month": monthData
        });

    } catch (err) {
        console.error(`Ошибка при получении данных:`, err);
        res.status(500).json({ error: 'Ошибка при получении данных из базы данных' });
    }
});

// Обработка маршрута /state (GET)
app.get('/state', (req, res) => {
    res.json(state); // Отправка данных состояния
});

app.get('/leaderboard/:period/:dateStr?', async (req, res) => {
    const { period, dateStr } = req.params;
    let tableName;

    const now = new Date();

    if (period === 'day') {
        const date = dateStr ? new Date(dateStr) : now;
        tableName = `day_${format(date, 'yyyy_MM_dd')}`;
    } else if (period === 'week') {
        const date = dateStr ? new Date(dateStr) : now;
        tableName = `week_${getWeekOfYearMonth(date)}`;
    } else if (period === 'month') {
        const date = dateStr ? new Date(dateStr) : now;
        tableName = `month_${format(date, 'yyyy_MM')}`;
    } else {
        return res.status(400).json({ error: 'Недопустимый период. Используйте "day", "week" или "month".' });
    }

    try {
        const values = await getValuesFromTable(tableName);

        values.sort((a, b) => b.score - a.score);
        res.json({ data: values });
    } catch (err) {
        console.error(`Ошибка при получении данных:`, err);
        res.status(500).json({ error: 'Ошибка при получении данных из базы данных' });
    }
});


// Запуск сервера
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});
