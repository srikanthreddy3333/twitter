const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const databasePath = path.join(__dirname, "twitterClone.db");
let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error :${error.message}`);
    process.exit(1);
  }
};
initializeDbAndServer();

//API 1 register
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `
    SELECT *
    FROM user
    WHERE username='${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (dbUser !== undefined) {
    //scenario 1 If the username already exists
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      //scenario 2 If the registrant provides a password with less than 6 characters
      response.status(400);
      response.send("Password is too short");
    } else {
      //scenario 3 Successful registration of the registrant
      const hashedPassword = await bcrypt.hash(password, 10);
      const requestQuery = `
        INSERT INTO
            user(name, username, password, gender)
        VALUES
            ('${name}','${username}','${hashedPassword}','${gender}');`;
      await database.run(requestQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//API 2 login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
    SELECT *
    FROM user
    WHERE username='${username}';`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//middleware function
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (!authHeader) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwtToken = authHeader.split(" ")[1];
    jwt.verify(jwtToken, "MY_SECRET_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//API 3 user tweets api
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
    SELECT user_id 
    FROM user 
    WHERE username='${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const latestTweets = await database.all(`
    SELECT
      user.username,
      tweet.tweet,
      tweet.date_time AS dateTime
    FROM
      follower
      LEFT JOIN tweet on tweet.user_id = follower.following_user_id
      LEFT JOIN user on follower.following_user_id = user.user_id
    WHERE 
      follower.follower_user_id = ${dbUser.user_id}
    ORDER BY 
      tweet.date_time desc
    LIMIT 4;`);
  response.send(latestTweets);
});

//API 4 list of all names of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE username='${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const { user_id } = dbUser;
  const followingUserQuery = `
    SELECT user.name
    FROM user 
      LEFT JOIN follower ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${user_id};`;
  const following = await database.all(followingUserQuery);
  response.send(following);
});

//API 5 list of all names of people who follows the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE username='${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const { user_id } = dbUser;
  const followerUserQuery = `
    SELECT user.name
    FROM user LEFT JOIN follower 
      ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${user_id};`;
  const follower = await database.all(followerUserQuery);
  response.send(follower);
});

//API 6 return the tweet, likes count, replies count and date-time
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  const getTweetQuery = `
    SELECT * 
    FROM tweet 
    WHERE tweet_id = ${tweetId};`;
  const tweetInfo = await database.get(getTweetQuery);

  const followingUsersQuery = `
    SELECT following_user_id 
    FROM follower 
    WHERE follower_user_id = ${dbUser.user_id};`;
  const followingUsersObjectsList = await database.all(followingUsersQuery);
  const followingUsersList = followingUsersObjectsList.map((object) => {
    return object["following_user_id"];
  });
  if (!followingUsersList.includes(tweetInfo.user_id)) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const { tweet_id, date_time, tweet } = tweetInfo;
    const getLikesQuery = `
      SELECT count(like_id) AS likes 
      FROM like 
      WHERE tweet_id = ${tweet_id} 
      GROUP BY tweet_id;`;
    const likesObject = await database.get(getLikesQuery);

    const getRepliesQuery = `
      SELECT count(reply_id) AS replies 
      FROM reply 
      WHERE tweet_id = ${tweet_id} 
      GROUP BY tweet_id;`;
    const repliesObject = await database.get(getRepliesQuery);
    response.send({
      tweet,
      likes: likesObject.likes,
      replies: repliesObject.replies,
      dateTime: date_time,
    });
  }
});

//API 7 return the list of usernames who liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const selectUserQuery = `
      SELECT * 
      FROM user 
      WHERE username = '${username}';`;
    const dbUser = await database.get(selectUserQuery);
    const getTweetQuery = `
      SELECT * 
      FROM tweet 
      WHERE tweet_id = ${tweetId};`;
    const tweetInfo = await database.get(getTweetQuery);

    const followingUsersQuery = `
      SELECT following_user_id 
      FROM follower 
      WHERE follower_user_id = ${dbUser.user_id};`;
    const followingUsersObjectsList = await database.all(followingUsersQuery);
    const followingUsersList = followingUsersObjectsList.map((object) => {
      return object["following_user_id"];
    });
    if (!followingUsersList.includes(tweetInfo.user_id)) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getUserQuery = `
        SELECT
          user.username
        FROM
          user
          NATURAL JOIN like
        WHERE 
          tweet_id =${tweetId};
          `;
      const likedBy = await database.all(getUserQuery);
      response.send({ likes: likedBy.map((item) => item.username) });
    }
  }
);

//API 8 If the user requests a tweet of a user he is following, return the list of replies

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const selectUserQuery = `
        SELECT * 
        FROM user 
        WHERE username = '${username}';`;
    const dbUser = await database.get(selectUserQuery);

    const getTweetQuery = `
        SELECT * 
        FROM tweet 
        WHERE tweet_id = ${tweetId};`;
    const tweetInfo = await database.get(getTweetQuery);

    const followingUsersQuery = `
        SELECT following_user_id 
        FROM follower 
        WHERE follower_user_id = ${dbUser.user_id};`;
    const followingUsersObjectsList = await database.all(followingUsersQuery);
    const followingUsersList = followingUsersObjectsList.map((object) => {
      return object["following_user_id"];
    });
    if (!followingUsersList.includes(tweetInfo.user_id)) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const { tweet_id, date_time } = tweetInfo;
      const getUserRepliesQuery = `
        SELECT 
          user.name AS name, 
          reply.reply AS reply
        FROM 
          reply 
          INNER JOIN user ON reply.user_id = user.user_id 
        WHERE 
          reply.tweet_id = ${tweet_id};
    `;
      const userRepliesObject = await database.all(getUserRepliesQuery);
      response.send({
        replies: userRepliesObject,
      });
    }
  }
);

//API 9 Returns a list of all tweets of the user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `
      SELECT user_id
      FROM user
      WHERE username ='${username}';`;
  const dbUser = await database.get(selectUserQuery);

  const getTweetsQuery = `
    SELECT
      tweet.tweet,
      count(distinct like.like_id) AS likes,
      count(distinct reply.reply_id) AS replies,
      tweet.date_time AS dateTime
      FROM
        tweet
        LEFT JOIN like ON tweet.tweet_id = like.tweet_id
        LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
       WHERE tweet.user_id = ${dbUser.user_id}
       GROUP BY tweet.tweet_id;;`;

  const tweetArray = await database.all(getTweetsQuery);
  response.send(tweetArray);
});

//API 10 Create a tweet in the tweet table

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const selectUserQuery = `
    SELECT user_id 
    FROM user 
    where username = "${username}";`;
  const dbUser = await database.get(selectUserQuery);

  const { user_id } = dbUser;
  const postTweetQuery = `
    INSERT INTO tweet
      (tweet, user_id)
    VALUES
    ("${tweet}",${user_id});`;
  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

//API 11 user requests to delete a tweet of other users
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
    const dbUser = await database.get(selectUserQuery);
    const getTweetQuery = `
      SELECT * 
      FROM tweet 
      WHERE tweet_id = ${tweetId};`;
    const tweetInfo = await database.get(getTweetQuery);
    if (dbUser.user_id !== tweetInfo.user_id) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
        DELETE FROM tweet 
        WHERE tweet_id = ${tweetId};`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
