const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

// Get table name from environment variables
const tableName = process.env.TABLE_NAME;

exports.handler = async (event) => {
  console.log(`EVENT: ${JSON.stringify(event)}`);
  
  const response = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*"
    },
    body: ""
  };

  try {
    const httpMethod = event.httpMethod;
    const path = event.path;
    const pathParameters = event.pathParameters;
    const requestBody = event.body ? JSON.parse(event.body) : {};

    console.log(`Method: ${httpMethod}, Path: ${path}`);

    switch (httpMethod) {
      case 'GET':
        if (path === '/dishes') {
          // Get all dishes
          const dishes = await getAllDishes();
          response.body = JSON.stringify(dishes);
        } else if (pathParameters && pathParameters.id) {
          // Get specific dish
          const dish = await getDish(pathParameters.id);
          response.body = JSON.stringify(dish);
        }
        break;

      case 'POST':
        if (path.includes('/vote')) {
          // Vote on a dish
          const voteResult = await voteDish(requestBody);
          response.body = JSON.stringify(voteResult);
        } else if (path === '/dishes') {
          // Create new dish (for initialization)
          const newDish = await createDish(requestBody);
          response.body = JSON.stringify(newDish);
        }
        break;

      case 'PUT':
        if (pathParameters && pathParameters.id) {
          // Update dish
          const updatedDish = await updateDish(pathParameters.id, requestBody);
          response.body = JSON.stringify(updatedDish);
        }
        break;

      case 'OPTIONS':
        // Handle CORS preflight
        response.body = JSON.stringify({ message: 'CORS preflight' });
        break;

      default:
        response.statusCode = 405;
        response.body = JSON.stringify({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error:', error);
    response.statusCode = 500;
    response.body = JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    });
  }

  return response;
};

// Get all dishes
async function getAllDishes() {
  const params = {
    TableName: tableName
  };
  
  try {
    const command = new ScanCommand(params);
    const result = await dynamodb.send(command);
    return result.Items || [];
  } catch (error) {
    console.error('Error getting dishes:', error);
    throw error;
  }
}

// Get single dish
async function getDish(dishId) {
  const params = {
    TableName: tableName,
    Key: { id: dishId }
  };
  
  try {
    const command = new GetCommand(params);
    const result = await dynamodb.send(command);
    return result.Item;
  } catch (error) {
    console.error('Error getting dish:', error);
    throw error;
  }
}

// Vote on a dish
async function voteDish(voteData) {
  const { dishId, vote, userEmail } = voteData;
  
  // Get current dish data
  const dish = await getDish(dishId);
  if (!dish) {
    throw new Error('Dish not found');
  }

  // Initialize vote counts if they don't exist
  if (!dish.good) dish.good = 0;
  if (!dish.bad) dish.bad = 0;
  if (!dish.userVotes) dish.userVotes = {};

  // Check if user already voted
  const previousVote = dish.userVotes[userEmail];
  
  // Remove previous vote if exists
  if (previousVote) {
    if (previousVote === 'good') {
      dish.good = Math.max(0, dish.good - 1);
    } else if (previousVote === 'bad') {
      dish.bad = Math.max(0, dish.bad - 1);
    }
  }

  // Add new vote if it's different from previous
  if (previousVote !== vote) {
    if (vote === 'good') {
      dish.good += 1;
    } else if (vote === 'bad') {
      dish.bad += 1;
    }
    dish.userVotes[userEmail] = vote;
  } else {
    // Same vote clicked = remove vote (toggle off)
    delete dish.userVotes[userEmail];
  }

  // Update dish in database
  const params = {
    TableName: tableName,
    Key: { id: dishId },
    UpdateExpression: 'SET good = :good, bad = :bad, userVotes = :userVotes, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':good': dish.good,
      ':bad': dish.bad,
      ':userVotes': dish.userVotes,
      ':updatedAt': new Date().toISOString()
    },
    ReturnValues: 'ALL_NEW'
  };

  try {
    const command = new UpdateCommand(params);
    const result = await dynamodb.send(command);
    return result.Attributes;
  } catch (error) {
    console.error('Error updating dish:', error);
    throw error;
  }
}

// Update dish
async function updateDish(dishId, dishData) {
  const params = {
    TableName: tableName,
    Key: { id: dishId },
    UpdateExpression: 'SET #name = :name, description = :description, good = :good, bad = :bad, meals = :meals, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#name': 'name'
    },
    ExpressionAttributeValues: {
      ':name': dishData.name,
      ':description': dishData.description,
      ':good': dishData.good || 0,
      ':bad': dishData.bad || 0,
      ':meals': dishData.meals || [],
      ':updatedAt': new Date().toISOString()
    },
    ReturnValues: 'ALL_NEW'
  };
  
  try {
    const command = new UpdateCommand(params);
    const result = await dynamodb.send(command);
    return result.Attributes;
  } catch (error) {
    console.error('Error updating dish:', error);
    throw error;
  }
}

// Create new dish (for initialization)
async function createDish(dishData) {
  const params = {
    TableName: tableName,
    Item: {
      id: dishData.id.toString(),
      ...dishData,
      good: dishData.good || 0,
      bad: dishData.bad || 0,
      userVotes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
  
  try {
    const command = new PutCommand(params);
    await dynamodb.send(command);
    return params.Item;
  } catch (error) {
    console.error('Error creating dish:', error);
    throw error;
  }
}